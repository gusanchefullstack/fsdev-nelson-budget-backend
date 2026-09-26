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

describe("US2 — budgets", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates, lists, reads, updates and deletes a budget", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent, { description: "Year plan" });
    expect(budget).toMatchObject({
      name: "2027",
      currency: "USD",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });

    const list = await api(agent).get("/api/v1/budgets");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ actualIncome: "0.00", actualExpense: "0.00" });

    const one = await api(agent).get(`/api/v1/budgets/${budget.id}`);
    expect(one.body.data.counts).toEqual({ categories: 0, items: 0, transactions: 0 });

    const upd = await api(agent).patch(`/api/v1/budgets/${budget.id}`, { name: "Plan 2027" });
    expect(upd.body.data.name).toBe("Plan 2027");

    expect((await api(agent).delete(`/api/v1/budgets/${budget.id}`)).status).toBe(204);
    expect((await api(agent).get(`/api/v1/budgets/${budget.id}`)).status).toBe(404);
  });

  it("requires endDate after startDate and valid fields", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/budgets", {
      name: "",
      currency: "EUR",
      startDate: "2027-12-31",
      endDate: "2027-01-01",
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(["name", "currency", "endDate"]),
    );
  });

  it("blocks overlapping budgets in the same currency (FR-010)", async () => {
    const { agent } = await signUpAgent();
    await createBudget(agent);
    const overlap = await api(agent).post("/api/v1/budgets", {
      name: "Mid",
      currency: "USD",
      startDate: "2027-07-01",
      endDate: "2028-06-30",
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.message).toContain("2027");
    expect(
      (
        await api(agent).post("/api/v1/budgets", {
          name: "2028",
          currency: "USD",
          startDate: "2028-01-01",
          endDate: "2028-12-31",
        })
      ).status,
    ).toBe(201);
    const cop = await api(agent).post("/api/v1/budgets", {
      name: "COP 2027",
      currency: "COP",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(cop.status).toBe(201);
    const moveIntoOverlap = await api(agent).patch(`/api/v1/budgets/${cop.body.data.id}`, {
      currency: "USD",
    });
    expect(moveIntoOverlap.status).toBe(409);
  });

  it("lets another user have their own USD 2027 budget", async () => {
    const a = await signUpAgent();
    const b = await signUpAgent();
    await createBudget(a.agent);
    await createBudget(b.agent);
  });

  it("blocks date changes that leave items outside, and currency changes once it has items", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    await createItem(agent, category.id);
    const shrink = await api(agent).patch(`/api/v1/budgets/${budget.id}`, {
      endDate: "2027-06-30",
    });
    expect(shrink.status).toBe(409);
    expect(shrink.body.error.message).toContain("Rent");
    const currency = await api(agent).patch(`/api/v1/budgets/${budget.id}`, { currency: "COP" });
    expect(currency.status).toBe(409);
  });

  it("allows a currency change on an empty budget", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const res = await api(agent).patch(`/api/v1/budgets/${budget.id}`, { currency: "COP" });
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe("COP");
  });

  it("returns counts and cascades delete to categories, items, buckets and transactions", async () => {
    const { agent, user } = await signUpAgent();
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id);
    const item = (await createItem(agent, category.id)).data;
    await seedExpense(user.id, item.id, "2027-02-18");

    const one = await api(agent).get(`/api/v1/budgets/${budget.id}`);
    expect(one.body.data.counts).toEqual({ categories: 1, items: 1, transactions: 1 });
    expect(one.body.data.categories[0].counts).toEqual({ items: 1, transactions: 1 });
    expect(one.body.data.categories[0].items[0]).toMatchObject({
      currency: "USD",
      transactionCount: 1,
    });

    expect((await api(agent).delete(`/api/v1/budgets/${budget.id}`)).status).toBe(204);
    expect(await prisma.bucket.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
    const account = await prisma.moneyAccount.findFirstOrThrow();
    expect(account.currentBalance.toFixed(2)).toBe("10000.00");
  });

  it("hides other users' budgets", async () => {
    const a = await signUpAgent();
    const b = await signUpAgent();
    const budget = await createBudget(a.agent);
    expect((await api(b.agent).get(`/api/v1/budgets/${budget.id}`)).status).toBe(404);
    expect((await api(b.agent).patch(`/api/v1/budgets/${budget.id}`, { name: "x" })).status).toBe(
      404,
    );
    expect((await api(b.agent).delete(`/api/v1/budgets/${budget.id}`)).status).toBe(404);
  });
});
