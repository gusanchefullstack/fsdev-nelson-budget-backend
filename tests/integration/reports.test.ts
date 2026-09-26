import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  api,
  createBudget,
  createCategory,
  createItem,
  prisma,
  resetDb,
  signUpAgent,
} from "../helpers.js";

/*
 * Hand-calculated dataset, today = 2027-04-10 (America/Bogota)
 * Rent 5,000 monthly on the 20th, paid once on Feb 18 (bucket #2); #1 and #3 missed.
 *   estimated to date 20,000 (#1–#4 started) · actual 5,000 · ratio 5,000/15,000
 *   remaining unpaid #4–#12 = 45,000 × 1/3 = 15,000 → projected 20,000 · recommended 1,666.67
 * Salary 8,000 monthly on the 30th, paid Jan 30 and Feb 27.
 *   estimated to date 24,000 (#1–#3 started) · actual 16,000 · ratio 1
 *   remaining unpaid #3–#12 = 80,000 → projected 96,000 · recommended 8,000
 * Projected net = 96,000 − 20,000 = 76,000 surplus
 */
let s: Awaited<ReturnType<typeof seed>>;

async function seed() {
  const { agent } = await signUpAgent();
  const budget = await createBudget(agent);
  const housing = await createCategory(agent, budget.id);
  const salaries = await createCategory(agent, budget.id, { type: "INCOME", name: "Salaries" });
  const rent = (await createItem(agent, housing.id)).data;
  const salary = (
    await createItem(agent, salaries.id, {
      name: "Salary",
      description: "Pay",
      estimatedAmount: "8000",
      firstExpectedDate: "2027-01-30",
    })
  ).data;
  const account = (
    await api(agent).post("/api/v1/accounts", {
      name: "Checking",
      type: "CHECKING",
      currency: "USD",
      openingBalance: "0",
    })
  ).body.data;
  const vendor = (
    await api(agent).post("/api/v1/vendors", { name: "Landlord", type: "SERVICE", currency: "USD" })
  ).body.data;
  const payor = (
    await api(agent).post("/api/v1/payors", { name: "Employer", type: "EMPLOYER", currency: "USD" })
  ).body.data;
  const post = (body: object) =>
    api(agent).post("/api/v1/transactions", { accountId: account.id, ...body });
  await post({
    itemId: rent.id,
    amount: "5000",
    localDateTime: "2027-02-18T20:00",
    vendorId: vendor.id,
  });
  await post({
    itemId: salary.id,
    amount: "8000",
    localDateTime: "2027-01-30T08:00",
    payorId: payor.id,
  });
  await post({
    itemId: salary.id,
    amount: "8000",
    localDateTime: "2027-02-27T08:00",
    payorId: payor.id,
  });
  return { agent, budget, rent, salary, account, vendor, payor };
}

describe("US5 — dashboard and reports", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-04-10T17:00:00Z"));
    await resetDb();
    s = await seed();
  }, 120_000);
  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$disconnect();
  });

  it("dashboard: totals, latest transactions and alerts (FR-044)", async () => {
    const res = await api(s.agent).get("/api/v1/dashboard");
    expect(res.status).toBe(200);
    const b = res.body.data.budgets[0];
    expect(b).toMatchObject({
      estimatedIncomeToDate: "24000.00",
      actualIncome: "16000.00",
      estimatedExpenseToDate: "20000.00",
      actualExpense: "5000.00",
      net: "11000.00",
    });
    expect(res.body.data.latestTransactions).toHaveLength(3);
    expect(res.body.data.latestTransactions[0].localDate).toBe("2027-02-27");
    const alerts = res.body.data.alerts;
    expect(alerts.filter((a: { type: string }) => a.type === "MISSED")).toHaveLength(2);
    expect(alerts.every((a: { itemId: string }) => a.itemId === s.rent.id)).toBe(true);
    expect(alerts.some((a: { type: string }) => a.type === "OVER_BUDGET")).toBe(false);
  });

  it("flags an over-budget expense but never an income above estimate", async () => {
    const extra = await api(s.agent).post("/api/v1/transactions", {
      itemId: s.rent.id,
      amount: "20000",
      localDateTime: "2027-04-06T10:00",
      accountId: s.account.id,
      vendorId: s.vendor.id,
    });
    const income = await api(s.agent).post("/api/v1/transactions", {
      itemId: s.salary.id,
      amount: "50000",
      localDateTime: "2027-04-01T10:00",
      accountId: s.account.id,
      payorId: s.payor.id,
    });
    const alerts = (await api(s.agent).get("/api/v1/dashboard")).body.data.alerts;
    expect(
      alerts
        .filter((a: { type: string }) => a.type === "OVER_BUDGET")
        .map((a: { itemId: string }) => a.itemId),
    ).toEqual([s.rent.id]);
    await api(s.agent).delete(`/api/v1/transactions/${extra.body.data.id}`);
    await api(s.agent).delete(`/api/v1/transactions/${income.body.data.id}`);
  });

  it("execution report with forecast (FR-046)", async () => {
    const res = await api(s.agent).get(`/api/v1/reports/budgets/${s.budget.id}/execution`);
    expect(res.status).toBe(200);
    const items = res.body.data.categories.flatMap((c: { items: unknown[] }) => c.items);
    expect(items.find((i: { itemName: string }) => i.itemName === "Rent")).toMatchObject({
      estimatedToDate: "20000.00",
      actual: "5000.00",
      projected: "20000.00",
    });
    expect(items.find((i: { itemName: string }) => i.itemName === "Salary")).toMatchObject({
      estimatedToDate: "24000.00",
      actual: "16000.00",
      projected: "96000.00",
    });
    expect(res.body.data.totals).toMatchObject({
      projectedIncome: "96000.00",
      projectedExpense: "20000.00",
      projectedNet: "76000.00",
    });
  });

  it("date filter narrows actual and estimated totals, not the projection", async () => {
    const res = await api(s.agent).get(
      `/api/v1/reports/budgets/${s.budget.id}/execution?from=2027-02-01&to=2027-02-28`,
    );
    const items = res.body.data.categories.flatMap((c: { items: unknown[] }) => c.items);
    expect(items.find((i: { itemName: string }) => i.itemName === "Rent")).toMatchObject({
      estimatedToDate: "5000.00",
      actual: "5000.00",
      projected: "20000.00",
    });
    expect(items.find((i: { itemName: string }) => i.itemName === "Salary")).toMatchObject({
      estimatedToDate: "8000.00",
      actual: "8000.00",
      projected: "96000.00",
    });
  });

  it("totals by account, payor and vendor", async () => {
    const q = (dim: string) =>
      api(s.agent).get(`/api/v1/reports/by-entity?dimension=${dim}&budgetId=${s.budget.id}`);
    expect((await q("account")).body.data).toEqual([
      { id: s.account.id, name: "Checking", income: "16000.00", expense: "5000.00" },
    ]);
    expect((await q("payor")).body.data).toEqual([
      { id: s.payor.id, name: "Employer", income: "16000.00", expense: "0.00" },
    ]);
    expect((await q("vendor")).body.data).toEqual([
      { id: s.vendor.id, name: "Landlord", income: "0.00", expense: "5000.00" },
    ]);
    expect((await q("planet")).status).toBe(422);
  });

  it("Top N by actual amount (FR-047)", async () => {
    const res = await api(s.agent).get(`/api/v1/reports/budgets/${s.budget.id}/top`);
    expect(res.body.data).toEqual({
      n: 5,
      income: [
        { itemId: s.salary.id, itemName: "Salary", categoryName: "Salaries", actual: "16000.00" },
      ],
      expense: [
        { itemId: s.rent.id, itemName: "Rent", categoryName: "Housing", actual: "5000.00" },
      ],
    });
    expect((await api(s.agent).get(`/api/v1/reports/budgets/${s.budget.id}/top?n=7`)).status).toBe(
      422,
    );
  });

  it("suggestions and recommendations (FR-048, FR-049)", async () => {
    const res = await api(s.agent).get(`/api/v1/reports/budgets/${s.budget.id}/suggestions`);
    const rules = res.body.data.suggestions.map((x: { rule: string }) => x.rule);
    expect(rules).toEqual(expect.arrayContaining(["MISSED_PAYMENTS", "PROJECTED_SURPLUS"]));
    expect(
      res.body.data.suggestions.find((x: { rule: string }) => x.rule === "PROJECTED_SURPLUS")
        .message,
    ).toMatch(/USD\s76,000\.00/);
    expect(res.body.data.recommendations).toEqual(
      expect.arrayContaining([
        { itemId: s.rent.id, itemName: "Rent", recommendedAmount: "1666.67" },
        { itemId: s.salary.id, itemName: "Salary", recommendedAmount: "8000.00" },
      ]),
    );
  });
});
