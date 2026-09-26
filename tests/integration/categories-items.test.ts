import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createBudget,
  createCategory,
  createItem,
  prisma,
  resetDb,
  seedExpense,
  signUpAgent,
} from "../helpers.js";

describe("US2 — categories and items", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates, updates and deletes categories; type is locked once it has items", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id, { description: "Home" });
    expect(category).toMatchObject({ type: "EXPENSE", name: "Housing", description: "Home" });
    expect(
      (await api(agent).patch(`/api/v1/categories/${category.id}`, { type: "INCOME" })).status,
    ).toBe(200);
    expect(
      (
        await api(agent).patch(`/api/v1/categories/${category.id}`, {
          type: "EXPENSE",
          name: "Home",
        })
      ).status,
    ).toBe(200);
    await createItem(agent, category.id);
    expect(
      (await api(agent).patch(`/api/v1/categories/${category.id}`, { type: "INCOME" })).status,
    ).toBe(409);
    expect((await api(agent).delete(`/api/v1/categories/${category.id}`)).status).toBe(204);
    expect(await prisma.budgetItem.count()).toBe(0);
  });

  it("defaults item dates to the budget and generates 12 monthly buckets", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const { data: item, notices } = await createItem(agent, category.id);
    expect(item).toMatchObject({
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      currency: "USD",
      estimatedAmount: "5000.00",
    });
    expect(notices ?? []).toHaveLength(0);
    expect(item.buckets).toHaveLength(12);
    expect(item.buckets[1]).toMatchObject({
      sequence: 2,
      startDate: "2027-02-05",
      endDate: "2027-03-04",
      expectedDate: "2027-02-20",
      currency: "USD",
    });
  });

  it("clamps dates into the budget with a notice (Netflix example)", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id, { name: "Subscriptions" });
    const { data: item, notices } = await createItem(agent, category.id, {
      name: "Netflix",
      startDate: "2027-03-15",
      endDate: "2028-03-15",
      firstExpectedDate: "2027-03-20",
      estimatedAmount: "20",
    });
    expect(item.endDate).toBe("2027-12-31");
    expect(notices[0].message).toContain("Dec 31, 2027");
    const early = await createItem(agent, category.id, {
      startDate: "2026-12-01",
      firstExpectedDate: "2027-01-20",
    });
    expect(early.data.startDate).toBe("2027-01-01");
    expect(early.notices).toHaveLength(1);
  });

  it.each([
    [{ firstExpectedDate: "2028-01-20" }, "firstExpectedDate"],
    [{ frequency: "CUSTOM_DAYS" }, "customInterval"],
    [{ frequency: "MONTHLY", customInterval: 2 }, "customInterval"],
    [{ description: "" }, "description"],
    [{ estimatedAmount: "0" }, "estimatedAmount"],
  ])("rejects %o", async (body, field) => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const res = await api(agent).post(`/api/v1/categories/${category.id}/items`, {
      name: "Rent",
      description: "Apartment rent",
      estimatedAmount: "5000",
      firstExpectedDate: "2027-01-20",
      frequency: "MONTHLY",
      ...body,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeTruthy();
  });

  it("accepts custom intervals", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const { data } = await createItem(agent, category.id, {
      frequency: "CUSTOM_DAYS",
      customInterval: 21,
    });
    expect(data.buckets[1].expectedDate).toBe("2027-02-10");
  });

  it("regenerates buckets on change and keeps transactions in the right bucket", async () => {
    const { agent, user } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const item = (await createItem(agent, category.id)).data;
    await seedExpense(user.id, item.id, "2027-02-18");
    await prisma.bucket.updateMany({
      where: { itemId: item.id, sequence: 2 },
      data: { actualAmount: "5000", actualDate: new Date("2027-02-18T00:00:00Z") },
    });

    const res = await api(agent).patch(`/api/v1/items/${item.id}`, {
      firstExpectedDate: "2027-01-05",
      estimatedAmount: "5200",
    });
    expect(res.status).toBe(200);
    const buckets = res.body.data.buckets;
    expect(buckets[0]).toMatchObject({
      startDate: "2027-01-01",
      expectedDate: "2027-01-05",
      estimatedAmount: "5200.00",
    });
    const holding = buckets.find((b: { actualAmount: string }) => b.actualAmount === "5000.00");
    // Expected on the 5th: bucket #3 runs Feb 18 – Mar 20 (starts 15 days before Mar 5)
    expect(holding).toMatchObject({
      sequence: 3,
      startDate: "2027-02-18",
      endDate: "2027-03-20",
      actualDate: "2027-02-18",
    });
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("blocks changes that leave a transaction outside the item range", async () => {
    const { agent, user } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const item = (await createItem(agent, category.id)).data;
    await seedExpense(user.id, item.id, "2027-02-18");
    const res = await api(agent).patch(`/api/v1/items/${item.id}`, {
      startDate: "2027-03-01",
      firstExpectedDate: "2027-03-20",
    });
    expect(res.status).toBe(409);
  });

  it("moves items only to a category of the same budget and type", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const housing = await createCategory(agent, budget.id);
    const utilities = await createCategory(agent, budget.id, { name: "Utilities" });
    const salaries = await createCategory(agent, budget.id, { type: "INCOME", name: "Salaries" });
    const other = await createBudget(agent, {
      name: "2028",
      startDate: "2028-01-01",
      endDate: "2028-12-31",
    });
    const otherCat = await createCategory(agent, other.id);
    const item = (await createItem(agent, housing.id)).data;

    expect(
      (await api(agent).patch(`/api/v1/items/${item.id}`, { categoryId: utilities.id })).status,
    ).toBe(200);
    expect(
      (await api(agent).patch(`/api/v1/items/${item.id}`, { categoryId: salaries.id })).status,
    ).toBe(422);
    expect(
      (await api(agent).patch(`/api/v1/items/${item.id}`, { categoryId: otherCat.id })).status,
    ).toBe(422);
  });

  it("returns transactionCount and cascades on item delete", async () => {
    const { agent, user } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const item = (await createItem(agent, category.id)).data;
    await seedExpense(user.id, item.id, "2027-02-18");
    expect((await api(agent).get(`/api/v1/items/${item.id}`)).body.data.transactionCount).toBe(1);
    expect((await api(agent).delete(`/api/v1/items/${item.id}`)).status).toBe(204);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.bucket.count()).toBe(0);
  });

  it("marks past buckets without transactions as MISSED", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent, {
      startDate: "2020-01-01",
      endDate: "2020-12-31",
      name: "2020",
    });
    const category = await createCategory(agent, budget.id);
    const item = (await createItem(agent, category.id, { firstExpectedDate: "2020-01-20" })).data;
    expect(item.buckets.every((b: { status: string }) => b.status === "MISSED")).toBe(true);
  });
});
