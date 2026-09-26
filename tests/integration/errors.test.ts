import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/lib/errors.js";
import {
  ORIGIN,
  api,
  app,
  createBudget,
  createCategory,
  createItem,
  prisma,
  request,
  resetDb,
  signUpAgent,
} from "../helpers.js";

describe("Principle III — friendly errors only", () => {
  beforeAll(resetDb);
  afterAll(() => prisma.$disconnect());

  it("turns an unexpected error into a generic 500 without internals", async () => {
    const boom = express();
    boom.get("/boom", () => {
      throw new Error('relation "secret_table" does not exist at /srv/app.ts:12');
    });
    boom.use(errorHandler);
    const original = console.error;
    console.error = () => {};
    const res = await request(boom).get("/boom");
    console.error = original;
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our side. Please try again.",
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret_table|\.ts|stack/);
  });

  it("answers malformed JSON with 400", async () => {
    const { agent } = await signUpAgent();
    const res = await agent
      .post("/api/v1/budgets")
      .set("Origin", ORIGIN)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 for another user's records in every collection", async () => {
    const owner = await signUpAgent();
    const stranger = await signUpAgent();
    const budget = await createBudget(owner.agent);
    const category = await createCategory(owner.agent, budget.id);
    const item = (await createItem(owner.agent, category.id)).data;
    const account = (
      await api(owner.agent).post("/api/v1/accounts", {
        name: "A",
        type: "CASH",
        currency: "USD",
        openingBalance: "0",
      })
    ).body.data;
    const payor = (
      await api(owner.agent).post("/api/v1/payors", { name: "P", type: "OTHER", currency: "USD" })
    ).body.data;
    const vendor = (
      await api(owner.agent).post("/api/v1/vendors", { name: "V", type: "OTHER", currency: "USD" })
    ).body.data;
    const tx = (
      await api(owner.agent).post("/api/v1/transactions", {
        itemId: item.id,
        amount: "1",
        localDateTime: "2027-02-01T10:00",
        accountId: account.id,
        vendorId: vendor.id,
      })
    ).body.data;

    const urls = [
      `/api/v1/budgets/${budget.id}`,
      `/api/v1/items/${item.id}`,
      `/api/v1/accounts/${account.id}`,
      `/api/v1/payors/${payor.id}`,
      `/api/v1/vendors/${vendor.id}`,
      `/api/v1/transactions/${tx.id}`,
      `/api/v1/reports/budgets/${budget.id}/execution`,
      `/api/v1/reports/budgets/${budget.id}/suggestions`,
    ];
    for (const url of urls) {
      const res = await api(stranger.agent).get(url);
      expect(res.status, url).toBe(404);
      expect(res.body.error.code, url).toBe("NOT_FOUND");
    }
    expect(
      (await api(stranger.agent).patch(`/api/v1/categories/${category.id}`, { name: "x" })).status,
    ).toBe(404);
    expect((await api(stranger.agent).delete(`/api/v1/categories/${category.id}`)).status).toBe(
      404,
    );
  });

  it("uses the same envelope for unknown routes", async () => {
    const res = await request(app).get("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
