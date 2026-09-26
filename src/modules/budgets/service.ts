import type { z } from "zod";
import { AppError, conflict } from "../../lib/errors.js";
import { recalcAccountBalances } from "../../lib/balances.js";
import { ownedBudget } from "../../lib/ownership.js";
import { prisma } from "../../lib/prisma.js";
import { day } from "../../lib/serialize.js";
import { fromPlainDate, todayIn } from "../../lib/temporal.js";
import { budgetTotals } from "../../lib/totals.js";
import { itemInclude, resolveSchedule, serializeItem, writeBuckets } from "../items/service.js";
import type { createBudgetSchema, updateBudgetSchema } from "./schemas.js";
import type { SessionUser } from "../../lib/session.js";

type BudgetRow = Awaited<ReturnType<typeof prisma.budget.findFirstOrThrow>>;

export const serializeBudget = (b: BudgetRow) => ({
  id: b.id,
  name: b.name,
  description: b.description,
  currency: b.currency,
  startDate: day(b.startDate)!,
  endDate: day(b.endDate)!,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

// FR-010: no two budgets in the same currency with overlapping dates.
async function assertNoOverlap(
  userId: string,
  currency: "USD" | "COP",
  startDate: string,
  endDate: string,
  exceptId?: string,
) {
  const other = await prisma.budget.findFirst({
    where: {
      userId,
      currency,
      id: exceptId ? { not: exceptId } : undefined,
      startDate: { lte: fromPlainDate(endDate) },
      endDate: { gte: fromPlainDate(startDate) },
    },
  });
  if (other) {
    throw conflict(
      `You already have a ${currency} budget (${other.name}) for these dates. Budgets in the same currency can't overlap.`,
    );
  }
}

export async function listBudgets(user: SessionUser) {
  const budgets = await prisma.budget.findMany({
    where: { userId: user.id },
    orderBy: { startDate: "desc" },
  });
  const totals = await budgetTotals(
    budgets.map((b) => b.id),
    todayIn(user.timezone).toString(),
  );
  return budgets.map((b) => ({ ...serializeBudget(b), ...totals.get(b.id)! }));
}

export async function createBudget(userId: string, data: z.output<typeof createBudgetSchema>) {
  await assertNoOverlap(userId, data.currency, data.startDate, data.endDate);
  const { categories = [], ...fields } = data;
  const range = { startDate: fromPlainDate(data.startDate), endDate: fromPlainDate(data.endDate) };

  // Resolve every item schedule first so a bad item fails before anything is written.
  const notices: { code: string; message: string }[] = [];
  const plans = categories.map((c, ci) =>
    c.items.map((item, ii) => {
      try {
        const { schedule, notices: itemNotices } = resolveSchedule(range, item);
        notices.push(...itemNotices.map((n) => ({ ...n, message: `${item.name}: ${n.message}` })));
        return { item, schedule };
      } catch (e) {
        if (e instanceof AppError && e.fields) {
          const prefixed = Object.fromEntries(
            Object.entries(e.fields).map(([k, v]) => [`categories.${ci}.items.${ii}.${k}`, v]),
          );
          throw new AppError(422, "VALIDATION_ERROR", e.message, prefixed);
        }
        throw e;
      }
    }),
  );

  // All-or-nothing (FR-016)
  const budget = await prisma.$transaction(
    async (tx) => {
      const b = await tx.budget.create({ data: { ...fields, userId, ...range } });
      for (const [ci, c] of categories.entries()) {
        const category = await tx.category.create({
          data: { budgetId: b.id, type: c.type, name: c.name, description: c.description },
        });
        for (const { item, schedule } of plans[ci]!) {
          const row = await tx.budgetItem.create({
            data: {
              categoryId: category.id,
              name: item.name,
              description: item.description,
              estimatedAmount: item.estimatedAmount,
              frequency: schedule.frequency,
              customInterval: schedule.customInterval ?? null,
              startDate: fromPlainDate(schedule.startDate),
              endDate: fromPlainDate(schedule.endDate),
              firstExpectedDate: fromPlainDate(schedule.firstExpectedDate),
            },
          });
          await writeBuckets(tx, row.id, schedule, item.estimatedAmount);
        }
      }
      return b;
    },
    { timeout: 60_000 },
  );
  return { data: serializeBudget(budget), notices };
}

export async function getBudget(user: SessionUser, id: string) {
  await ownedBudget(user.id, id);
  const budget = await prisma.budget.findUniqueOrThrow({
    where: { id },
    include: {
      categories: {
        orderBy: { createdAt: "asc" },
        include: { items: { orderBy: { createdAt: "asc" }, include: itemInclude } },
      },
    },
  });
  const today = todayIn(user.timezone);
  const totals = (await budgetTotals([id], today.toString())).get(id)!;
  const categories = budget.categories.map((c) => {
    const items = c.items.map((i) => serializeItem({ ...i, category: { ...c, budget } }, today));
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      description: c.description,
      counts: {
        items: items.length,
        transactions: items.reduce((n, i) => n + i.transactionCount, 0),
      },
      items,
    };
  });
  return {
    ...serializeBudget(budget),
    ...totals,
    counts: {
      categories: categories.length,
      items: categories.reduce((n, c) => n + c.counts.items, 0),
      transactions: categories.reduce((n, c) => n + c.counts.transactions, 0),
    },
    categories,
  };
}

export async function updateBudget(
  userId: string,
  id: string,
  data: z.output<typeof updateBudgetSchema>,
) {
  const current = await ownedBudget(userId, id);
  const next = {
    currency: data.currency ?? current.currency,
    startDate: data.startDate ?? day(current.startDate)!,
    endDate: data.endDate ?? day(current.endDate)!,
  };
  if (next.endDate <= next.startDate) throw conflict("The end date must be after the start date.");

  const items = await prisma.budgetItem.findMany({
    where: { category: { budgetId: id } },
    select: { name: true, startDate: true, endDate: true },
  });
  if (data.currency && data.currency !== current.currency && items.length > 0) {
    throw conflict("The currency can't change once the budget has items.");
  }
  const outside = items.filter(
    (i) => day(i.startDate)! < next.startDate || day(i.endDate)! > next.endDate,
  );
  if (outside.length > 0) {
    throw conflict(
      `These items would fall outside the new dates: ${outside.map((i) => i.name).join(", ")}. Change their dates first.`,
    );
  }
  await assertNoOverlap(userId, next.currency, next.startDate, next.endDate, id);

  const budget = await prisma.budget.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      currency: next.currency,
      startDate: fromPlainDate(next.startDate),
      endDate: fromPlainDate(next.endDate),
    },
  });
  return serializeBudget(budget);
}

export async function deleteBudget(userId: string, id: string) {
  await ownedBudget(userId, id);
  await prisma.$transaction(async (tx) => {
    const accounts = await tx.transaction.findMany({
      where: { item: { category: { budgetId: id } } },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    await tx.budget.delete({ where: { id } });
    await recalcAccountBalances(
      tx,
      accounts.map((a) => a.accountId),
    );
  });
}
