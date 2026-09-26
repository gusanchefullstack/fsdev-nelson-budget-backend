import "temporal-polyfill/global";
import type { z } from "zod";
import { budgetInsights, itemMetrics } from "../../domain/insights.js";
import { ownedBudget } from "../../lib/ownership.js";
import { prisma } from "../../lib/prisma.js";
import { money } from "../../lib/serialize.js";
import type { SessionUser } from "../../lib/session.js";
import { fromPlainDate, todayIn } from "../../lib/temporal.js";
import { loadInsightItems } from "./load.js";
import type { byEntitySchema, rangeSchema, topSchema } from "./schemas.js";

const cents = (v: string) => Math.round(Number(v) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);
const inRange = (d: Temporal.PlainDate, from?: string, to?: string) =>
  (!from || Temporal.PlainDate.compare(d, Temporal.PlainDate.from(from)) >= 0) &&
  (!to || Temporal.PlainDate.compare(d, Temporal.PlainDate.from(to)) <= 0);

/** FR-046: the date range narrows estimated/actual totals; the projection always covers the whole budget. */
export async function executionReport(
  user: SessionUser,
  budgetId: string,
  range: z.output<typeof rangeSchema>,
) {
  const budget = await ownedBudget(user.id, budgetId);
  const today = todayIn(user.timezone);
  const items = await loadInsightItems({ userId: user.id, budgetId });
  const filtered = Boolean(range.from || range.to);

  const actualInRange = new Map<string, number>();
  if (filtered) {
    const sums = await prisma.transaction.groupBy({
      by: ["itemId"],
      where: {
        item: { category: { budgetId } },
        localDate: {
          gte: range.from ? fromPlainDate(range.from) : undefined,
          lte: range.to ? fromPlainDate(range.to) : undefined,
        },
      },
      _sum: { amount: true },
    });
    for (const s of sums) actualInRange.set(s.itemId, cents(money(s._sum.amount)));
  }

  const categories = new Map<
    string,
    { id: string; name: string; type: string; items: unknown[] }
  >();
  const totals = {
    estimatedIncomeToDate: 0,
    actualIncome: 0,
    estimatedExpenseToDate: 0,
    actualExpense: 0,
    projectedIncome: 0,
    projectedExpense: 0,
  };

  for (const { insight, categoryId } of items) {
    const m = itemMetrics(insight, today);
    const estimated = filtered
      ? insight.buckets
          .filter(
            (b) =>
              Temporal.PlainDate.compare(b.startDate, today) <= 0 &&
              inRange(b.startDate, range.from, range.to),
          )
          .reduce((n, b) => n + cents(b.estimatedAmount), 0)
      : cents(m.estimatedToDate);
    const actual = filtered ? (actualInRange.get(insight.id) ?? 0) : cents(m.actualToDate);
    const row = {
      itemId: insight.id,
      itemName: insight.name,
      estimatedToDate: fmt(estimated),
      actual: fmt(actual),
      ratio: Math.round(m.ratio * 10000) / 10000,
      projected: m.projected,
    };
    if (!categories.has(categoryId))
      categories.set(categoryId, {
        id: categoryId,
        name: insight.categoryName,
        type: insight.type,
        items: [],
      });
    categories.get(categoryId)!.items.push(row);
    if (insight.type === "INCOME") {
      totals.estimatedIncomeToDate += estimated;
      totals.actualIncome += actual;
      totals.projectedIncome += cents(m.projected);
    } else {
      totals.estimatedExpenseToDate += estimated;
      totals.actualExpense += actual;
      totals.projectedExpense += cents(m.projected);
    }
  }

  return {
    budget: { id: budget.id, name: budget.name, currency: budget.currency },
    range: { from: range.from ?? null, to: range.to ?? null },
    categories: [...categories.values()],
    totals: {
      estimatedIncomeToDate: fmt(totals.estimatedIncomeToDate),
      actualIncome: fmt(totals.actualIncome),
      estimatedExpenseToDate: fmt(totals.estimatedExpenseToDate),
      actualExpense: fmt(totals.actualExpense),
      projectedIncome: fmt(totals.projectedIncome),
      projectedExpense: fmt(totals.projectedExpense),
      projectedNet: fmt(totals.projectedIncome - totals.projectedExpense),
    },
  };
}

export async function byEntityReport(userId: string, q: z.output<typeof byEntitySchema>) {
  await ownedBudget(userId, q.budgetId);
  const key = ({ account: "accountId", payor: "payorId", vendor: "vendorId" } as const)[
    q.dimension
  ];
  const sums = await prisma.transaction.groupBy({
    by: [key, "type"],
    where: {
      userId,
      item: { category: { budgetId: q.budgetId } },
      localDate: {
        gte: q.from ? fromPlainDate(q.from) : undefined,
        lte: q.to ? fromPlainDate(q.to) : undefined,
      },
      ...(key === "accountId" ? {} : { [key]: { not: null } }),
    },
    _sum: { amount: true },
  });
  const ids = [...new Set(sums.map((s) => s[key] as string))];
  const names =
    q.dimension === "account"
      ? await prisma.moneyAccount.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : q.dimension === "payor"
        ? await prisma.payor.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : await prisma.vendor.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          });
  return names
    .map(({ id, name }) => {
      const rows = sums.filter((s) => s[key] === id);
      const total = (type: string) =>
        rows.filter((r) => r.type === type).reduce((n, r) => n + cents(money(r._sum.amount)), 0);
      return { id, name, income: fmt(total("INCOME")), expense: fmt(total("EXPENSE")) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function topReport(
  user: SessionUser,
  budgetId: string,
  q: z.output<typeof topSchema>,
) {
  await ownedBudget(user.id, budgetId);
  const today = todayIn(user.timezone);
  const metrics = (await loadInsightItems({ userId: user.id, budgetId })).map(({ insight }) =>
    itemMetrics(insight, today),
  );
  const top = (type: "INCOME" | "EXPENSE") =>
    metrics
      .filter((m) => m.type === type && cents(m.actualToDate) > 0)
      .sort((a, b) => cents(b.actualToDate) - cents(a.actualToDate))
      .slice(0, q.n)
      .map((m) => ({
        itemId: m.itemId,
        itemName: m.itemName,
        categoryName: m.categoryName,
        actual: m.actualToDate,
      }));
  return { n: q.n, income: top("INCOME"), expense: top("EXPENSE") };
}

export async function suggestionsReport(user: SessionUser, budgetId: string) {
  const budget = await ownedBudget(user.id, budgetId);
  const items = (await loadInsightItems({ userId: user.id, budgetId })).map((i) => i.insight);
  const { suggestions, recommendations, projectedNet } = budgetInsights(
    items,
    todayIn(user.timezone),
    budget.currency,
  );
  return { suggestions, recommendations, projectedNet };
}
