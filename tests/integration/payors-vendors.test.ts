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

describe.each([
  ["payors", "EMPLOYER", "INCOME"],
  ["vendors", "UTILITY", "EXPENSE"],
] as const)("US3 — %s", (collection, validType, txType) => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates, lists, reads, updates and deletes", async () => {
    const { agent } = await signUpAgent();
    const created = await api(agent).post(`/api/v1/${collection}`, {
      name: "Acme",
      type: validType,
      currency: "USD",
      description: "Main",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect((await api(agent).get(`/api/v1/${collection}`)).body.data).toHaveLength(1);
    expect((await api(agent).get(`/api/v1/${collection}/${id}`)).body.data).toMatchObject({
      name: "Acme",
      transactionCount: 0,
    });
    expect(
      (await api(agent).patch(`/api/v1/${collection}/${id}`, { name: "Acme Inc" })).body.data.name,
    ).toBe("Acme Inc");
    expect((await api(agent).delete(`/api/v1/${collection}/${id}`)).status).toBe(204);
  });

  it.each([
    [{ type: "SPACESHIP" }, "type"],
    [{ country: "Colombia" }, "country"],
    [{ phoneCountryCode: "57" }, "phoneCountryCode"],
  ])("rejects %o", async (body, field) => {
    const { agent } = await signUpAgent();
    const res = await api(agent).post(`/api/v1/${collection}`, {
      name: "Acme",
      type: validType,
      currency: "USD",
      ...body,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeTruthy();
  });

  it("blocks deleting one that transactions reference", async () => {
    const { agent, user } = await signUpAgent();
    const party = (
      await api(agent).post(`/api/v1/${collection}`, {
        name: "Acme",
        type: validType,
        currency: "USD",
      })
    ).body.data;
    const budget = await createBudget(agent);
    const category = await createCategory(agent, budget.id, { type: txType });
    const item = (await createItem(agent, category.id)).data;
    const account = await prisma.moneyAccount.create({
      data: {
        userId: user.id,
        name: "Checking",
        type: "CHECKING",
        currency: "USD",
        openingBalance: "0",
        currentBalance: "0",
      },
    });
    await prisma.transaction.create({
      data: {
        userId: user.id,
        itemId: item.id,
        bucketId: item.buckets[0].id,
        type: txType,
        amount: "10",
        currency: "USD",
        occurredAt: new Date("2027-01-10T12:00:00Z"),
        timezone: "UTC",
        localDate: new Date("2027-01-10T00:00:00Z"),
        accountId: account.id,
        ...(txType === "INCOME" ? { payorId: party.id } : { vendorId: party.id }),
      },
    });
    const del = await api(agent).delete(`/api/v1/${collection}/${party.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain("1 transaction");
  });

  it("hides records from other users", async () => {
    const a = await signUpAgent();
    const b = await signUpAgent();
    const party = (
      await api(a.agent).post(`/api/v1/${collection}`, {
        name: "Acme",
        type: validType,
        currency: "USD",
      })
    ).body.data;
    expect((await api(b.agent).get(`/api/v1/${collection}/${party.id}`)).status).toBe(404);
    expect((await api(b.agent).get(`/api/v1/${collection}`)).body.data).toHaveLength(0);
  });
});
