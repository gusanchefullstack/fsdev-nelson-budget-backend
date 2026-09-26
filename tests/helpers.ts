import request from "supertest";
import app from "../src/index.js";
import { prisma } from "../src/lib/prisma.js";

export const ORIGIN = "http://localhost:5173";

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "Transaction", "Bucket", "BudgetItem", "Category", "Budget",
    "money_account", "Payor", "Vendor", "session", "account", "verification", "rate_limit", "user"
    CASCADE`);
}

let seq = 0;
export function profile(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const id = `${Date.now().toString(36)}${seq}`;
  return {
    name: "Test User",
    email: `user${id}@example.com`,
    username: `user${id}`,
    password: "correct-horse-1",
    firstName: "Test",
    lastName: "User",
    address: "1 Main St",
    city: "San Francisco",
    postalCode: "94105",
    state: "CA",
    country: "US",
    phoneCountryCode: "+1",
    phoneNumber: "4155550100",
    timezone: "America/Bogota",
    ...overrides,
  };
}

/** Signs a new user up and returns a Supertest agent holding the session cookie. */
export async function signUpAgent(overrides: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  const body = profile(overrides);
  const res = await agent.post("/api/auth/sign-up/email").set("Origin", ORIGIN).send(body);
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; email: string; username: string }, body };
}

export const api = (agent: ReturnType<typeof request.agent>) => ({
  get: (url: string) => agent.get(url).set("Origin", ORIGIN),
  post: (url: string, body?: object) => agent.post(url).set("Origin", ORIGIN).send(body),
  patch: (url: string, body?: object) => agent.patch(url).set("Origin", ORIGIN).send(body),
  delete: (url: string) => agent.delete(url).set("Origin", ORIGIN),
});

export async function createBudget(
  agent: ReturnType<typeof request.agent>,
  body: Record<string, unknown> = {},
) {
  const res = await api(agent).post("/api/v1/budgets", {
    name: "2027",
    currency: "USD",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
    ...body,
  });
  if (res.status !== 201)
    throw new Error(`budget failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export { app, prisma, request };

export async function createCategory(
  agent: ReturnType<typeof request.agent>,
  budgetId: string,
  body: Record<string, unknown> = {},
) {
  const res = await api(agent).post(`/api/v1/budgets/${budgetId}/categories`, {
    type: "EXPENSE",
    name: "Housing",
    ...body,
  });
  if (res.status !== 201)
    throw new Error(`category failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function createItem(
  agent: ReturnType<typeof request.agent>,
  categoryId: string,
  body: Record<string, unknown> = {},
) {
  const res = await api(agent).post(`/api/v1/categories/${categoryId}/items`, {
    name: "Rent",
    description: "Apartment rent",
    estimatedAmount: "5000.00",
    firstExpectedDate: "2027-01-20",
    frequency: "MONTHLY",
    ...body,
  });
  if (res.status !== 201) throw new Error(`item failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Inserts an expense transaction directly (used before the transactions API exists). */
export async function seedExpense(
  userId: string,
  itemId: string,
  localDate: string,
  amount = "5000.00",
) {
  const account = await prisma.moneyAccount.create({
    data: {
      userId,
      name: "Checking",
      type: "CHECKING",
      currency: "USD",
      openingBalance: "10000",
      currentBalance: "10000",
    },
  });
  const vendor = await prisma.vendor.create({
    data: { userId, name: "Landlord", type: "SERVICE", currency: "USD" },
  });
  const bucket = await prisma.bucket.findFirstOrThrow({
    where: {
      itemId,
      startDate: { lte: new Date(`${localDate}T00:00:00Z`) },
      endDate: { gte: new Date(`${localDate}T00:00:00Z`) },
    },
  });
  return prisma.transaction.create({
    data: {
      userId,
      itemId,
      bucketId: bucket.id,
      type: "EXPENSE",
      amount,
      currency: "USD",
      occurredAt: new Date(`${localDate}T12:00:00Z`),
      timezone: "America/Bogota",
      localDate: new Date(`${localDate}T00:00:00Z`),
      accountId: account.id,
      vendorId: vendor.id,
    },
  });
}
