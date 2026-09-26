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

const checking = {
  name: "Checking",
  type: "CHECKING",
  currency: "USD",
  openingBalance: "10000.00",
};

async function seedTxOnAccount(
  userId: string,
  agent: Parameters<typeof api>[0],
  accountId: string,
) {
  const budget = await createBudget(agent);
  const category = await createCategory(agent, budget.id);
  const item = (await createItem(agent, category.id)).data;
  const vendor = await prisma.vendor.create({
    data: { userId, name: "Landlord", type: "SERVICE", currency: "USD" },
  });
  await prisma.transaction.create({
    data: {
      userId,
      itemId: item.id,
      bucketId: item.buckets[1].id,
      type: "EXPENSE",
      amount: "5000",
      currency: "USD",
      occurredAt: new Date("2027-02-18T12:00:00Z"),
      timezone: "America/Bogota",
      localDate: new Date("2027-02-18T00:00:00Z"),
      accountId,
      vendorId: vendor.id,
    },
  });
}

describe("US3 — accounts", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates an account whose current balance starts at the opening balance", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/accounts", {
      ...checking,
      currentBalance: "99",
      city: "Bogotá",
      country: "CO",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      openingBalance: "10000.00",
      currentBalance: "10000.00",
      city: "Bogotá",
      transactionCount: 0,
    });
    expect((await api(agent).get("/api/v1/accounts")).body.data).toHaveLength(1);
  });

  it.each([
    [{ type: "PIGGY" }, "type"],
    [{ currency: "EUR" }, "currency"],
    [{ openingBalance: "abc" }, "openingBalance"],
    [{ name: "" }, "name"],
    [{ phoneNumber: "12" }, "phoneNumber"],
  ])("rejects %o", async (body, field) => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/accounts", { ...checking, ...body });
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeTruthy();
  });

  it("accepts a negative opening balance (credit card)", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post("/api/v1/accounts", {
      name: "Visa",
      type: "CREDIT_CARD",
      currency: "USD",
      openingBalance: "-250.50",
    });
    expect(res.body.data.currentBalance).toBe("-250.50");
  });

  it("recalculates the balance when the opening balance changes", async () => {
    const { agent, user } = await signUpAgent();
    const account = (await api(agent).post("/api/v1/accounts", checking)).body.data;
    await seedTxOnAccount(user.id, agent, account.id);
    const res = await api(agent).patch(`/api/v1/accounts/${account.id}`, {
      openingBalance: "12000",
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      openingBalance: "12000.00",
      currentBalance: "7000.00",
      transactionCount: 1,
    });
  });

  it("locks the currency once the account has transactions and blocks deleting it", async () => {
    const { agent, user } = await signUpAgent();
    const account = (await api(agent).post("/api/v1/accounts", checking)).body.data;
    await seedTxOnAccount(user.id, agent, account.id);
    expect(
      (await api(agent).patch(`/api/v1/accounts/${account.id}`, { currency: "COP" })).status,
    ).toBe(409);
    const del = await api(agent).delete(`/api/v1/accounts/${account.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain("1 transaction");
  });

  it("deletes an unused account and hides accounts from other users", async () => {
    const a = await signUpAgent();
    const b = await signUpAgent();
    const account = (await api(a.agent).post("/api/v1/accounts", checking)).body.data;
    expect((await api(b.agent).get(`/api/v1/accounts/${account.id}`)).status).toBe(404);
    expect((await api(a.agent).delete(`/api/v1/accounts/${account.id}`)).status).toBe(204);
  });
});
