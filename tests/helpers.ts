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
