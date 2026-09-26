import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createBudget,
  createCategory,
  createItem,
  prisma,
  resetDb,
  signUpAgent,
} from "../helpers.js";

async function setup() {
  const { agent, user } = await signUpAgent(); // profile timezone America/Bogota
  const budget = await createBudget(agent);
  const housing = await createCategory(agent, budget.id);
  const salaries = await createCategory(agent, budget.id, { type: "INCOME", name: "Salaries" });
  const rent = (await createItem(agent, housing.id)).data;
  const salary = (
    await createItem(agent, salaries.id, {
      name: "Salary",
      description: "Monthly pay",
      firstExpectedDate: "2027-01-30",
    })
  ).data;
  const account = (
    await api(agent).post("/api/v1/accounts", {
      name: "Checking",
      type: "CHECKING",
      currency: "USD",
      openingBalance: "10000",
    })
  ).body.data;
  const cop = (
    await api(agent).post("/api/v1/accounts", {
      name: "Efectivo",
      type: "CASH",
      currency: "COP",
      openingBalance: "0",
    })
  ).body.data;
  const vendor = (
    await api(agent).post("/api/v1/vendors", { name: "Landlord", type: "SERVICE", currency: "USD" })
  ).body.data;
  const payor = (
    await api(agent).post("/api/v1/payors", { name: "Employer", type: "EMPLOYER", currency: "USD" })
  ).body.data;
  return { agent, user, budget, rent, salary, account, cop, vendor, payor };
}

const bucket = (itemId: string, sequence: number) =>
  prisma.bucket.findFirstOrThrow({ where: { itemId, sequence } });
const balance = async (id: string) =>
  (await prisma.moneyAccount.findUniqueOrThrow({ where: { id } })).currentBalance.toFixed(2);

describe("US4 — transactions", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("allocates an expense to its bucket and updates the bucket and balance (scenario 9)", async () => {
    const s = await setup();
    const res = await api(s.agent).post("/api/v1/transactions", {
      itemId: s.rent.id,
      amount: "5000",
      localDateTime: "2027-02-18T20:00",
      accountId: s.account.id,
      vendorId: s.vendor.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: "EXPENSE",
      currency: "USD",
      timezone: "America/Bogota",
      localDate: "2027-02-18",
      localDateTime: "2027-02-18T20:00",
      occurredAt: "2027-02-19T01:00:00.000Z",
      amount: "5000.00",
    });
    const b2 = await bucket(s.rent.id, 2);
    expect(res.body.data.bucketId).toBe(b2.id);
    expect(b2.actualAmount.toFixed(2)).toBe("5000.00");
    expect(b2.actualDate?.toISOString().slice(0, 10)).toBe("2027-02-18");
    expect(await balance(s.account.id)).toBe("5000.00");
  });

  it("sums several transactions in one bucket and restores values on delete (scenario 10)", async () => {
    const s = await setup();
    const post = (amount: string, when: string) =>
      api(s.agent).post("/api/v1/transactions", {
        itemId: s.rent.id,
        amount,
        localDateTime: when,
        accountId: s.account.id,
        vendorId: s.vendor.id,
      });
    await post("5000", "2027-02-18T20:00");
    const second = (await post("100", "2027-02-20T09:00")).body.data;
    let b2 = await bucket(s.rent.id, 2);
    expect(b2.actualAmount.toFixed(2)).toBe("5100.00");
    expect(b2.actualDate?.toISOString().slice(0, 10)).toBe("2027-02-20");
    expect(await balance(s.account.id)).toBe("4900.00");

    expect((await api(s.agent).delete(`/api/v1/transactions/${second.id}`)).status).toBe(204);
    b2 = await bucket(s.rent.id, 2);
    expect(b2.actualAmount.toFixed(2)).toBe("5000.00");
    expect(b2.actualDate?.toISOString().slice(0, 10)).toBe("2027-02-18");
    expect(await balance(s.account.id)).toBe("5000.00");
  });

  it("adds income to the account", async () => {
    const s = await setup();
    const res = await api(s.agent).post("/api/v1/transactions", {
      itemId: s.salary.id,
      amount: "8000",
      localDateTime: "2027-01-30T08:00",
      accountId: s.account.id,
      payorId: s.payor.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("INCOME");
    expect(await balance(s.account.id)).toBe("18000.00");
  });

  it("moves buckets and accounts on edit", async () => {
    const s = await setup();
    const savings = (
      await api(s.agent).post("/api/v1/accounts", {
        name: "Savings",
        type: "SAVINGS",
        currency: "USD",
        openingBalance: "0",
      })
    ).body.data;
    const tx = (
      await api(s.agent).post("/api/v1/transactions", {
        itemId: s.rent.id,
        amount: "5000",
        localDateTime: "2027-02-18T20:00",
        accountId: s.account.id,
        vendorId: s.vendor.id,
      })
    ).body.data;
    const res = await api(s.agent).patch(`/api/v1/transactions/${tx.id}`, {
      localDateTime: "2027-03-10T10:00",
      accountId: savings.id,
      amount: "4800",
    });
    expect(res.status).toBe(200);
    expect((await bucket(s.rent.id, 2)).actualAmount.toFixed(2)).toBe("0.00");
    expect((await bucket(s.rent.id, 3)).actualAmount.toFixed(2)).toBe("4800.00");
    expect(await balance(s.account.id)).toBe("10000.00");
    expect(await balance(savings.id)).toBe("-4800.00");
  });

  it.each([
    ["a date outside the item range", { localDateTime: "2028-01-05T10:00" }, "localDateTime"],
    ["an account in another currency", { useCop: true }, "accountId"],
    ["a payor on an expense", { usePayor: true }, "payorId"],
    [
      "a time that doesn't exist (DST)",
      { localDateTime: "2027-03-14T02:30", timezone: "America/Los_Angeles" },
      "localDateTime",
    ],
    ["a zero amount", { amount: "0" }, "amount"],
  ])("rejects %s (scenario 11)", async (_label, opts, field) => {
    const s = await setup();
    const o = opts as {
      localDateTime?: string;
      useCop?: boolean;
      usePayor?: boolean;
      timezone?: string;
      amount?: string;
    };
    if (o.timezone) await api(s.agent).patch("/api/v1/me", { timezone: o.timezone });
    const res = await api(s.agent).post("/api/v1/transactions", {
      itemId: s.rent.id,
      amount: o.amount ?? "5000",
      localDateTime: o.localDateTime ?? "2027-02-18T20:00",
      accountId: o.useCop ? s.cop.id : s.account.id,
      ...(o.usePayor ? { payorId: s.payor.id } : { vendorId: s.vendor.id }),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeTruthy();
  });

  it("keeps existing transactions when the profile timezone changes; new ones use it (scenario 12)", async () => {
    const s = await setup();
    const tx = (
      await api(s.agent).post("/api/v1/transactions", {
        itemId: s.rent.id,
        amount: "5000",
        localDateTime: "2027-02-18T20:00",
        accountId: s.account.id,
        vendorId: s.vendor.id,
      })
    ).body.data;
    await api(s.agent).patch("/api/v1/me", { timezone: "America/Los_Angeles" });
    const again = await api(s.agent).get(`/api/v1/transactions/${tx.id}`);
    expect(again.body.data).toMatchObject({
      timezone: "America/Bogota",
      localDateTime: "2027-02-18T20:00",
      bucketId: tx.bucketId,
    });
    const next = await api(s.agent).post("/api/v1/transactions", {
      itemId: s.rent.id,
      amount: "10",
      localDateTime: "2027-02-18T20:00",
      accountId: s.account.id,
      vendorId: s.vendor.id,
    });
    expect(next.body.data.timezone).toBe("America/Los_Angeles");
  });

  it("blocks deleting a vendor in use (scenario 13) and lists with filters", async () => {
    const s = await setup();
    await api(s.agent).post("/api/v1/transactions", {
      itemId: s.rent.id,
      amount: "5000",
      localDateTime: "2027-02-18T20:00",
      accountId: s.account.id,
      vendorId: s.vendor.id,
    });
    await api(s.agent).post("/api/v1/transactions", {
      itemId: s.salary.id,
      amount: "8000",
      localDateTime: "2027-01-30T08:00",
      accountId: s.account.id,
      payorId: s.payor.id,
    });
    const del = await api(s.agent).delete(`/api/v1/vendors/${s.vendor.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain("1 transaction");

    const all = await api(s.agent).get("/api/v1/transactions");
    expect(all.body).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(all.body.data[0].localDate).toBe("2027-02-18"); // newest first
    expect(all.body.data[0]).toMatchObject({
      itemName: "Rent",
      accountName: "Checking",
      vendorName: "Landlord",
    });
    const expenses = await api(s.agent).get("/api/v1/transactions?type=EXPENSE");
    expect(expenses.body.total).toBe(1);
    const byPayor = await api(s.agent).get(`/api/v1/transactions?payorId=${s.payor.id}`);
    expect(byPayor.body.data[0].payorName).toBe("Employer");
    const range = await api(s.agent).get("/api/v1/transactions?from=2027-02-01&to=2027-02-28");
    expect(range.body.total).toBe(1);
  });

  it("hides other users' transactions and rejects their items or accounts", async () => {
    const s = await setup();
    const other = await signUpAgent();
    const tx = (
      await api(s.agent).post("/api/v1/transactions", {
        itemId: s.rent.id,
        amount: "5000",
        localDateTime: "2027-02-18T20:00",
        accountId: s.account.id,
        vendorId: s.vendor.id,
      })
    ).body.data;
    expect((await api(other.agent).get(`/api/v1/transactions/${tx.id}`)).status).toBe(404);
    const steal = await api(other.agent).post("/api/v1/transactions", {
      itemId: s.rent.id,
      amount: "1",
      localDateTime: "2027-02-18T20:00",
      accountId: s.account.id,
      vendorId: s.vendor.id,
    });
    expect(steal.status).toBe(404);
  });
});
