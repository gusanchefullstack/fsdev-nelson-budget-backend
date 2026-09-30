import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("no longer serves the spec 003 planned-totals preview (spec 004 FR-020)", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/budget-previews", {
      name: "2027",
      currency: "USD",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
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

const cents = (v: string) => Math.round(Number(v) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);
type Figures = { estimatedTotal: string; estimatedToDate: string; actual: string };
type DetailItem = { id: string; figures: Figures };
type DetailCategory = { type: string; name: string; figures: Figures; items: DetailItem[] };

// Spec 004: per-item and per-category execution figures, today = 2027-04-10 (America/Bogota)
describe("GET /budgets/:id figures", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-04-10T17:00:00Z"));
    await resetDb();
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => prisma.$disconnect());

  it("sums bucket estimates and actuals per item, category and type, matching the report", async () => {
    const { agent } = await signUpAgent();
    const budget = await createBudget(agent);
    const housing = await createCategory(agent, budget.id);
    const salaries = await createCategory(agent, budget.id, { type: "INCOME", name: "Salaries" });
    await createCategory(agent, budget.id, { name: "Empty" });

    const frequencies: [string, Record<string, unknown>][] = [
      ["ONE_TIME", { firstExpectedDate: "2027-03-15" }],
      ["DAILY", { estimatedAmount: "10", firstExpectedDate: "2027-01-01" }],
      ["WEEKLY", { estimatedAmount: "100", firstExpectedDate: "2027-01-04" }],
      ["BIWEEKLY", { estimatedAmount: "200", firstExpectedDate: "2027-01-08" }],
      ["MONTHLY", {}],
      ["QUARTERLY", { firstExpectedDate: "2027-02-01" }],
      ["ANNUALLY", { firstExpectedDate: "2027-06-30" }],
      [
        "CUSTOM_DAYS",
        { customInterval: 10, estimatedAmount: "50", firstExpectedDate: "2027-01-10" },
      ],
      ["CUSTOM_MONTHS", { customInterval: 2, firstExpectedDate: "2027-01-15" }],
    ];
    const items: Record<string, { id: string }> = {};
    for (const [frequency, extra] of frequencies) {
      items[frequency] = (
        await createItem(agent, housing.id, { name: frequency, frequency, ...extra })
      ).data;
    }
    // Past the budget end: clamped to Dec 31
    const clamped = (
      await createItem(agent, housing.id, { name: "Clamped", endDate: "2028-06-30" })
    ).data;
    const salary = (
      await createItem(agent, salaries.id, {
        name: "Salary",
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
      await api(agent).post("/api/v1/vendors", {
        name: "Landlord",
        type: "SERVICE",
        currency: "USD",
      })
    ).body.data;
    const payor = (
      await api(agent).post("/api/v1/payors", {
        name: "Employer",
        type: "EMPLOYER",
        currency: "USD",
      })
    ).body.data;
    const post = async (body: object) => {
      const res = await api(agent).post("/api/v1/transactions", { accountId: account.id, ...body });
      expect(res.status).toBe(201);
    };
    await post({
      itemId: items.MONTHLY!.id,
      amount: "5000",
      localDateTime: "2027-02-18T20:00",
      vendorId: vendor.id,
    });
    await post({
      itemId: items.WEEKLY!.id,
      amount: "120.25",
      localDateTime: "2027-03-02T09:00",
      vendorId: vendor.id,
    });
    await post({
      itemId: items.CUSTOM_DAYS!.id,
      amount: "45",
      localDateTime: "2027-01-12T09:00",
      vendorId: vendor.id,
    });
    await post({
      itemId: salary.id,
      amount: "8000",
      localDateTime: "2027-01-30T08:00",
      payorId: payor.id,
    });

    const res = await api(agent).get(`/api/v1/budgets/${budget.id}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    const categories = data.categories as DetailCategory[];
    const allItems = categories.flatMap((c) => c.items);

    // (a) every frequency, and the clamped item: estimated total = sum of stored bucket estimates
    for (const item of [...Object.values(items), clamped, salary]) {
      const buckets = await prisma.bucket.findMany({ where: { itemId: item.id } });
      const got = allItems.find((i) => i.id === item.id)!.figures;
      expect(got.estimatedTotal).toBe(
        fmt(buckets.reduce((n, b) => n + cents(b.estimatedAmount.toFixed(2)), 0)),
      );
      expect(got.actual).toBe(
        fmt(buckets.reduce((n, b) => n + cents(b.actualAmount.toFixed(2)), 0)),
      );
    }
    expect(allItems.find((i) => i.id === items.WEEKLY!.id)!.figures.actual).toBe("120.25");

    // (b) category = sum of its items; an empty category is all zeros
    for (const c of categories) {
      for (const key of ["estimatedTotal", "estimatedToDate", "actual"] as const) {
        expect(c.figures[key]).toBe(fmt(c.items.reduce((n, i) => n + cents(i.figures[key]), 0)));
      }
    }
    expect(categories.find((c) => c.name === "Empty")!.figures).toEqual({
      estimatedTotal: "0.00",
      estimatedToDate: "0.00",
      actual: "0.00",
    });

    // (c) per-type sums match the new full-period totals and the existing to-date totals
    const byType = (type: string, key: keyof Figures) =>
      fmt(categories.filter((c) => c.type === type).reduce((n, c) => n + cents(c.figures[key]), 0));
    expect(data.estimatedIncomeTotal).toBe(byType("INCOME", "estimatedTotal"));
    expect(data.estimatedExpenseTotal).toBe(byType("EXPENSE", "estimatedTotal"));
    expect(data.estimatedIncomeToDate).toBe(byType("INCOME", "estimatedToDate"));
    expect(data.estimatedExpenseToDate).toBe(byType("EXPENSE", "estimatedToDate"));
    expect(data.actualIncome).toBe(byType("INCOME", "actual"));
    expect(data.actualExpense).toBe(byType("EXPENSE", "actual"));

    // (d) parity with the execution report (no date range)
    const report = await api(agent).get(`/api/v1/reports/budgets/${budget.id}/execution`);
    const reportItems = (
      report.body.data.categories as {
        items: { itemId: string; actual: string; estimatedToDate: string }[];
      }[]
    ).flatMap((c) => c.items);
    for (const r of reportItems) {
      const got = allItems.find((i) => i.id === r.itemId)!.figures;
      expect(got.actual).toBe(r.actual);
      expect(got.estimatedToDate).toBe(r.estimatedToDate);
    }
    expect(reportItems).toHaveLength(allItems.length);

    // (e) 2-decimal money strings
    for (const i of allItems) {
      for (const v of Object.values(i.figures)) expect(v).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});
