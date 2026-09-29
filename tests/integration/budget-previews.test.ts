import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, app, prisma, request, resetDb, signUpAgent } from "../helpers.js";

const item = (
  name: string,
  frequency: string,
  first: string,
  amount: string,
  extra: Record<string, unknown> = {},
) => ({
  name,
  description: `${name} description`,
  estimatedAmount: amount,
  firstExpectedDate: first,
  frequency,
  ...extra,
});

const allFrequencies = {
  name: "2027",
  currency: "USD",
  startDate: "2027-01-01",
  endDate: "2027-12-31",
  categories: [
    {
      type: "INCOME",
      name: "Salaries",
      items: [
        item("Salary", "MONTHLY", "2027-01-20", "5000"),
        item("Freelance", "BIWEEKLY", "2027-01-08", "900"),
        item("Bonus", "ANNUALLY", "2027-06-01", "99.99"),
      ],
    },
    { type: "INCOME", name: "Savings", items: [] },
    {
      type: "EXPENSE",
      name: "Living",
      items: [
        item("Coffee", "DAILY", "2027-01-01", "1.5"),
        item("Groceries", "WEEKLY", "2027-01-04", "25"),
        item("Insurance", "QUARTERLY", "2027-02-15", "300.33"),
        item("Laptop", "ONE_TIME", "2027-03-10", "1200"),
        item("Parking", "CUSTOM_DAYS", "2027-01-05", "12.34", { customInterval: 10 }),
        item("Haircut", "CUSTOM_MONTHS", "2027-01-31", "70", { customInterval: 2 }),
        item("Gym", "MONTHLY", "2027-02-01", "40", { endDate: "2028-01-31" }),
      ],
    },
  ],
};

type PreviewItem = { name: string; plannedTotal: string; occurrences: number };
type PreviewCategory = { type: string; name: string; plannedTotal: string; items: PreviewItem[] };

async function counts() {
  return {
    budgets: await prisma.budget.count(),
    categories: await prisma.category.count(),
    items: await prisma.budgetItem.count(),
    buckets: await prisma.bucket.count(),
  };
}

describe("Budget previews (FR-005, FR-006)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("matches the saved buckets for every frequency and a clamped end date", async () => {
    const { agent } = await signUpAgent();
    const preview = await api(agent).post("/api/v1/budget-previews", allFrequencies);
    expect(preview.status).toBe(200);
    const created = await api(agent).post("/api/v1/budgets", allFrequencies);
    expect(created.status).toBe(201);

    const saved = await prisma.budgetItem.findMany({
      include: { buckets: { select: { estimatedAmount: true } } },
    });
    const savedTotal = (name: string) =>
      saved
        .find((i) => i.name === name)!
        .buckets.reduce((sum, b) => sum + Number(b.estimatedAmount) * 100, 0) / 100;

    const categories = preview.body.data.categories as PreviewCategory[];
    expect(categories.map((c) => c.name)).toEqual(["Salaries", "Savings", "Living"]);
    for (const c of categories) {
      for (const i of c.items) {
        expect(Number(i.plannedTotal), i.name).toBeCloseTo(savedTotal(i.name), 2);
      }
    }
    // Gym is clamped to Dec 31, 2027: Feb–Dec = 11 occurrences
    const gym = categories[2]!.items.find((i) => i.name === "Gym")!;
    expect(gym).toEqual({ name: "Gym", plannedTotal: "440.00", occurrences: 11 });
    expect(preview.body.data.notices).toEqual(created.body.notices);
    expect(
      preview.body.data.notices.some((n: { message: string }) => n.message.startsWith("Gym:")),
    ).toBe(true);
  });

  it("sums categories, groups and a negative net", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/budget-previews", {
      name: "Budget 2026",
      currency: "USD",
      startDate: "2026-09-28",
      endDate: "2027-04-30",
      categories: [
        { type: "INCOME", name: "Savings", items: [] },
        {
          type: "EXPENSE",
          name: "Rent",
          items: [item("Channel Mission Bay", "MONTHLY", "2026-10-01", "5490")],
        },
        {
          type: "EXPENSE",
          name: "Healthcare",
          items: [item("Kaiser", "MONTHLY", "2026-10-01", "400")],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      currency: "USD",
      plannedIncome: "0.00",
      plannedExpense: "41230.00",
      plannedNet: "-41230.00",
      categories: [
        { type: "INCOME", name: "Savings", plannedTotal: "0.00", items: [] },
        {
          type: "EXPENSE",
          name: "Rent",
          plannedTotal: "38430.00",
          items: [{ name: "Channel Mission Bay", plannedTotal: "38430.00", occurrences: 7 }],
        },
        { type: "EXPENSE", name: "Healthcare", plannedTotal: "2800.00" },
      ],
      notices: [],
    });
  });

  it("rejects an overlapping budget with the same message as create", async () => {
    const { agent } = await signUpAgent();
    const body = { ...allFrequencies, categories: [] };
    expect((await api(agent).post("/api/v1/budgets", body)).status).toBe(201);
    const preview = await api(agent).post("/api/v1/budget-previews", body);
    const create = await api(agent).post("/api/v1/budgets", body);
    expect(preview.status).toBe(409);
    expect(preview.body.error).toEqual(create.body.error);
  });

  it("points validation errors at the same field as create", async () => {
    const { agent } = await signUpAgent();
    const bad = structuredClone(allFrequencies);
    bad.categories[2]!.items[0]!.firstExpectedDate = "2029-01-01";
    const res = await api(agent).post("/api/v1/budget-previews", bad);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields["categories.2.items.0.firstExpectedDate"]).toBeTruthy();
  });

  it("requires a session", async () => {
    const res = await request(app)
      .post("/api/v1/budget-previews")
      .set("Origin", ORIGIN)
      .send(allFrequencies);
    expect(res.status).toBe(401);
  });

  it("writes nothing", async () => {
    const { agent } = await signUpAgent();
    const before = await counts();
    expect((await api(agent).post("/api/v1/budget-previews", allFrequencies)).status).toBe(200);
    expect((await api(agent).post("/api/v1/budget-previews", allFrequencies)).status).toBe(200);
    expect(await counts()).toEqual(before);
  });
});
