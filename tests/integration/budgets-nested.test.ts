import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, createBudget, prisma, resetDb, signUpAgent } from "../helpers.js";

const item = (name: string, first: string, amount = "100") => ({
  name,
  description: `${name} description`,
  estimatedAmount: amount,
  firstExpectedDate: first,
  frequency: "MONTHLY",
});

const full = {
  name: "2027",
  currency: "USD",
  startDate: "2027-01-01",
  endDate: "2027-12-31",
  categories: [
    {
      type: "INCOME",
      name: "Salaries",
      items: [item("Salary", "2027-01-30", "8000"), item("Bonus", "2027-06-15", "500")],
    },
    { type: "EXPENSE", name: "Housing", items: [item("Rent", "2027-01-20", "5000")] },
    {
      type: "EXPENSE",
      name: "Subscriptions",
      items: [
        item("Netflix", "2027-01-15", "20"),
        { ...item("Gym", "2027-02-01", "40"), endDate: "2028-01-31" },
      ],
    },
  ],
};

describe("US6 — nested budget creation (FR-016)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates budget, categories, items and buckets in one request", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/budgets", full);
    expect(res.status).toBe(201);
    const detail = (await api(agent).get(`/api/v1/budgets/${res.body.data.id}`)).body.data;
    expect(detail.counts).toEqual({ categories: 3, items: 5, transactions: 0 });
    // Salary 12 + Bonus (from Jun) 7 + Rent 12 + Netflix 12 + Gym (from Feb) 11
    expect(await prisma.bucket.count()).toBe(54);
    const gym = detail.categories[2].items[1];
    expect(gym.endDate).toBe("2027-12-31");
    expect(res.body.notices.some((n: { message: string }) => n.message.includes("Gym"))).toBe(true);
  });

  it("creates nothing when any item is invalid, and points at the field", async () => {
    const { agent } = await signUpAgent();
    const bad = structuredClone(full);
    bad.categories[1]!.items[0]!.firstExpectedDate = "2029-01-01";
    const res = await api(agent).post("/api/v1/budgets", bad);
    expect(res.status).toBe(422);
    expect(res.body.error.fields["categories.1.items.0.firstExpectedDate"]).toBeTruthy();
    expect(await prisma.budget.count()).toBe(0);
    expect(await prisma.category.count()).toBe(0);
  });

  it("rejects a malformed nested item before touching the database", async () => {
    const { agent } = await signUpAgent();
    const bad = structuredClone(full);
    (bad.categories[0]!.items[0] as Record<string, unknown>).estimatedAmount = "-5";
    const res = await api(agent).post("/api/v1/budgets", bad);
    expect(res.status).toBe(422);
    expect(res.body.error.fields["categories.0.items.0.estimatedAmount"]).toBeTruthy();
  });

  it("still enforces the overlap rule", async () => {
    const { agent } = await signUpAgent();
    await createBudget(agent);
    const res = await api(agent).post("/api/v1/budgets", full);
    expect(res.status).toBe(409);
    expect(await prisma.category.count()).toBe(0);
  });
});
