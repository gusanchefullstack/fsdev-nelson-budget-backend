/**
 * SC-006 check: one user with a year of data (50 items, 1,000 transactions), then time the
 * heaviest endpoints. Run: npx tsx --env-file=.env prisma/seed-perf.ts
 */
import "temporal-polyfill/global";
import request from "supertest";
import app from "../src/index.js";
import { recalcAccountBalances } from "../src/lib/balances.js";
import { recomputeBucketActuals } from "../src/lib/bucket-actuals.js";
import { prisma } from "../src/lib/prisma.js";

const ORIGIN = "http://localhost:5173";
const id = Date.now().toString(36);
const agent = request.agent(app);
const post = (url: string, body: object) =>
  agent.post(url).set("Origin", ORIGIN).set("X-Forwarded-For", `10.99.${id.length}.1`).send(body);

async function main() {
  const signUp = await post("/api/auth/sign-up/email", {
    name: "Perf User",
    email: `perf${id}@example.com`,
    username: `perf${id}`,
    password: "correct-horse-1",
    firstName: "Perf",
    lastName: "User",
    address: "1 Main",
    city: "Bogotá",
    postalCode: "110111",
    state: "DC",
    country: "CO",
    phoneCountryCode: "+57",
    phoneNumber: "3001234567",
    timezone: "America/Bogota",
  });
  if (signUp.status !== 200) throw new Error(`sign-up ${signUp.status}`);
  const userId = signUp.body.user.id as string;

  const categories = Array.from({ length: 10 }, (_, c) => ({
    type: c < 3 ? "INCOME" : "EXPENSE",
    name: `Category ${c + 1}`,
    items: Array.from({ length: 5 }, (_, i) => ({
      name: `Item ${c + 1}.${i + 1}`,
      description: "Seeded",
      estimatedAmount: String(100 + i * 50),
      firstExpectedDate: `2025-01-${String(5 + i * 5).padStart(2, "0")}`,
      frequency: i === 4 ? "WEEKLY" : "MONTHLY",
    })),
  }));
  const budget = await post("/api/v1/budgets", {
    name: "Perf 2025",
    currency: "USD",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    categories,
  });
  if (budget.status !== 201)
    throw new Error(`budget ${budget.status} ${JSON.stringify(budget.body)}`);
  const account = (
    await post("/api/v1/accounts", {
      name: "Checking",
      type: "CHECKING",
      currency: "USD",
      openingBalance: "0",
    })
  ).body.data;
  const vendor = (await post("/api/v1/vendors", { name: "Vendor", type: "STORE", currency: "USD" }))
    .body.data;
  const payor = (await post("/api/v1/payors", { name: "Payor", type: "EMPLOYER", currency: "USD" }))
    .body.data;

  // 1,000 transactions spread over the year, inserted in bulk
  const items = await prisma.budgetItem.findMany({
    where: { category: { budgetId: budget.body.data.id } },
    include: { buckets: true, category: true },
  });
  const rows = Array.from({ length: 1000 }, (_, n) => {
    const item = items[n % items.length]!;
    const bucket = item.buckets[n % item.buckets.length]!;
    return {
      userId,
      itemId: item.id,
      bucketId: bucket.id,
      type: item.category.type,
      amount: "42.50",
      currency: "USD" as const,
      occurredAt: new Date(bucket.startDate.getTime() + 17 * 3600_000),
      timezone: "America/Bogota",
      localDate: bucket.startDate,
      accountId: account.id,
      payorId: item.category.type === "INCOME" ? payor.id : null,
      vendorId: item.category.type === "EXPENSE" ? vendor.id : null,
    };
  });
  await prisma.transaction.createMany({ data: rows });
  await prisma.$transaction(
    async (tx) => {
      await recomputeBucketActuals(tx, new Set(rows.map((r) => r.bucketId)));
      await recalcAccountBalances(tx, [account.id]);
    },
    { timeout: 120_000 },
  );

  const b = budget.body.data.id;
  const endpoints = [
    "/api/v1/dashboard",
    "/api/v1/budgets",
    `/api/v1/budgets/${b}`,
    `/api/v1/reports/budgets/${b}/execution`,
    `/api/v1/reports/by-entity?dimension=vendor&budgetId=${b}`,
    `/api/v1/reports/budgets/${b}/top?n=20`,
    `/api/v1/reports/budgets/${b}/suggestions`,
    "/api/v1/transactions?pageSize=50",
  ];
  console.log(
    `Seeded: ${items.length} items, ${await prisma.bucket.count({ where: { item: { category: { budgetId: b } } } })} buckets, 1000 transactions`,
  );
  for (const url of endpoints) {
    await agent.get(url); // warm-up
    const t0 = performance.now();
    const res = await agent.get(url);
    console.log(
      `${String(res.status).padEnd(4)} ${Math.round(performance.now() - t0)
        .toString()
        .padStart(5)} ms  ${url.replace(b, ":budgetId")}`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
