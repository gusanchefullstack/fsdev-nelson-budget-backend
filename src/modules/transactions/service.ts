import "temporal-polyfill/global";
import type { z } from "zod";
import { recalcAccountBalances } from "../../lib/balances.js";
import { recomputeBucketActuals } from "../../lib/bucket-actuals.js";
import { AppError, notFound } from "../../lib/errors.js";
import { ownedItem } from "../../lib/ownership.js";
import { prisma } from "../../lib/prisma.js";
import { day, money } from "../../lib/serialize.js";
import type { SessionUser } from "../../lib/session.js";
import { fromPlainDate, toPlainDate, zonedFromLocal } from "../../lib/temporal.js";
import type {
  createTransactionSchema,
  listTransactionsSchema,
  updateTransactionSchema,
} from "./schemas.js";

const include = {
  item: {
    select: {
      name: true,
      category: { select: { budgetId: true, budget: { select: { name: true } } } },
    },
  },
  account: { select: { name: true } },
  payor: { select: { name: true } },
  vendor: { select: { name: true } },
};

type Row = Awaited<
  ReturnType<typeof prisma.transaction.findFirstOrThrow<{ include: typeof include }>>
>;

const invalid = (fields: Record<string, string>) =>
  new AppError(
    422,
    "VALIDATION_ERROR",
    Object.values(fields)[0] ?? "Please check the highlighted fields.",
    fields,
  );

const usDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function serializeTransaction(t: Row) {
  // Shown in the timezone it was recorded in (FR-042a).
  const local = Temporal.Instant.fromEpochMilliseconds(t.occurredAt.getTime()).toZonedDateTimeISO(
    t.timezone,
  );
  return {
    id: t.id,
    itemId: t.itemId,
    itemName: t.item.name,
    budgetId: t.item.category.budgetId,
    budgetName: t.item.category.budget.name,
    bucketId: t.bucketId,
    type: t.type,
    amount: money(t.amount),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    timezone: t.timezone,
    localDate: day(t.localDate)!,
    localDateTime: local.toPlainDateTime().toString({ smallestUnit: "minute" }),
    accountId: t.accountId,
    accountName: t.account.name,
    payorId: t.payorId,
    payorName: t.payor?.name ?? null,
    vendorId: t.vendorId,
    vendorName: t.vendor?.name ?? null,
  };
}

type Input = z.output<typeof createTransactionSchema>;

/** Validates ownership, currency, origin/destination and date; returns the row to write (FR-040–FR-042a). */
async function resolve(user: SessionUser, input: Input, timezone: string) {
  const item = await ownedItem(user.id, input.itemId);
  const type = item.category.type;
  const currency = item.category.budget.currency;

  const account = await prisma.moneyAccount.findFirst({
    where: { id: input.accountId, userId: user.id },
  });
  if (!account) throw notFound("We couldn't find that account.");
  if (account.currency !== currency) {
    throw invalid({ accountId: `Use an account in ${currency}, the currency of this budget.` });
  }

  if (type === "INCOME") {
    if (input.vendorId) throw invalid({ vendorId: "Income comes from a payor, not a vendor." });
    if (!input.payorId) throw invalid({ payorId: "Choose who paid you." });
    if (!(await prisma.payor.findFirst({ where: { id: input.payorId, userId: user.id } })))
      throw notFound("We couldn't find that payor.");
  } else {
    if (input.payorId) throw invalid({ payorId: "Expenses go to a vendor, not a payor." });
    if (!input.vendorId) throw invalid({ vendorId: "Choose who you paid." });
    if (!(await prisma.vendor.findFirst({ where: { id: input.vendorId, userId: user.id } })))
      throw notFound("We couldn't find that vendor.");
  }

  let zoned: Temporal.ZonedDateTime;
  try {
    zoned = zonedFromLocal(input.localDateTime, timezone);
  } catch (e) {
    if (e instanceof AppError) throw invalid({ localDateTime: e.message });
    throw e;
  }
  const localDate = zoned.toPlainDate();
  const start = toPlainDate(item.startDate);
  const end = toPlainDate(item.endDate);
  if (
    Temporal.PlainDate.compare(localDate, start) < 0 ||
    Temporal.PlainDate.compare(localDate, end) > 0
  ) {
    throw invalid({
      localDateTime: `The date must be between ${usDate.format(item.startDate)} and ${usDate.format(item.endDate)}, the dates of ${item.name}.`,
    });
  }
  const bucket = await prisma.bucket.findFirst({
    where: {
      itemId: item.id,
      startDate: { lte: fromPlainDate(localDate) },
      endDate: { gte: fromPlainDate(localDate) },
    },
  });
  if (!bucket)
    throw invalid({ localDateTime: "That date doesn't fall in any period of this item." });

  return {
    userId: user.id,
    itemId: item.id,
    bucketId: bucket.id,
    type,
    currency,
    amount: input.amount,
    occurredAt: new Date(zoned.epochMilliseconds),
    timezone,
    localDate: fromPlainDate(localDate),
    accountId: account.id,
    payorId: type === "INCOME" ? input.payorId! : null,
    vendorId: type === "EXPENSE" ? input.vendorId! : null,
  };
}

async function owned(userId: string, id: string) {
  const tx = await prisma.transaction.findFirst({ where: { id, userId }, include });
  if (!tx) throw notFound("We couldn't find that transaction.");
  return tx;
}

export async function createTransaction(user: SessionUser, input: Input) {
  const data = await resolve(user, input, user.timezone);
  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.transaction.create({ data });
    await recomputeBucketActuals(tx, [data.bucketId]);
    await recalcAccountBalances(tx, [data.accountId]);
    return row.id;
  });
  return serializeTransaction(await owned(user.id, id));
}

export async function updateTransaction(
  user: SessionUser,
  id: string,
  patch: z.output<typeof updateTransactionSchema>,
) {
  const current = await owned(user.id, id);
  const currentLocal = Temporal.Instant.fromEpochMilliseconds(current.occurredAt.getTime())
    .toZonedDateTimeISO(current.timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
  const merged: Input = {
    itemId: patch.itemId ?? current.itemId,
    amount: patch.amount ?? money(current.amount),
    localDateTime: patch.localDateTime ?? currentLocal,
    accountId: patch.accountId ?? current.accountId,
    payorId: patch.payorId !== undefined ? patch.payorId : current.payorId,
    vendorId: patch.vendorId !== undefined ? patch.vendorId : current.vendorId,
  };
  // An edited time is read in the transaction's own timezone, never the profile's.
  const data = await resolve(user, merged, current.timezone);
  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({ where: { id }, data });
    await recomputeBucketActuals(tx, [current.bucketId, data.bucketId]);
    await recalcAccountBalances(tx, [current.accountId, data.accountId]);
  });
  return serializeTransaction(await owned(user.id, id));
}

export async function deleteTransaction(userId: string, id: string) {
  const current = await owned(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.transaction.delete({ where: { id } });
    await recomputeBucketActuals(tx, [current.bucketId]);
    await recalcAccountBalances(tx, [current.accountId]);
  });
}

export async function getTransaction(userId: string, id: string) {
  return serializeTransaction(await owned(userId, id));
}

export async function listTransactions(userId: string, q: z.output<typeof listTransactionsSchema>) {
  const where = {
    userId,
    itemId: q.itemId,
    accountId: q.accountId,
    payorId: q.payorId,
    vendorId: q.vendorId,
    type: q.type,
    item: q.budgetId ? { category: { budgetId: q.budgetId } } : undefined,
    localDate:
      q.from || q.to
        ? {
            gte: q.from ? fromPlainDate(q.from) : undefined,
            lte: q.to ? fromPlainDate(q.to) : undefined,
          }
        : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.transaction.count({ where }),
  ]);
  return { data: rows.map(serializeTransaction), page: q.page, pageSize: q.pageSize, total };
}
