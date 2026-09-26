import "temporal-polyfill/global";
import type { z } from "zod";
import {
  findBucket,
  generateBuckets,
  type Frequency,
  type ItemSchedule,
} from "../../domain/buckets.js";
import { AppError, conflict } from "../../lib/errors.js";
import { recalcAccountBalances } from "../../lib/balances.js";
import { recomputeBucketActuals } from "../../lib/bucket-actuals.js";
import { ownedCategory, ownedItem } from "../../lib/ownership.js";
import { prisma, type Tx } from "../../lib/prisma.js";
import { day, money } from "../../lib/serialize.js";
import type { SessionUser } from "../../lib/session.js";
import { fromPlainDate, toPlainDate, todayIn } from "../../lib/temporal.js";
import type { createItemSchema, updateItemSchema } from "./schemas.js";

export const itemInclude = {
  buckets: { orderBy: { sequence: "asc" as const } },
  _count: { select: { transactions: true } },
};

type ItemRow = Awaited<
  ReturnType<typeof prisma.budgetItem.findFirstOrThrow<{ include: typeof itemInclude }>>
> & {
  category: { type: string; budget: { currency: string } };
};

type Notice = { code: string; message: string };

const usDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const pretty = (d: Temporal.PlainDate) => usDate.format(fromPlainDate(d));

function bucketStatus(
  endDate: Date,
  actualAmount: { isZero(): boolean },
  today: Temporal.PlainDate,
) {
  if (Temporal.PlainDate.compare(toPlainDate(endDate), today) >= 0) return "OPEN";
  return actualAmount.isZero() ? "MISSED" : "CLOSED";
}

export function serializeItem(item: ItemRow, today: Temporal.PlainDate) {
  const currency = item.category.budget.currency;
  return {
    id: item.id,
    categoryId: item.categoryId,
    type: item.category.type,
    name: item.name,
    description: item.description,
    startDate: day(item.startDate)!,
    endDate: day(item.endDate)!,
    estimatedAmount: money(item.estimatedAmount),
    firstExpectedDate: day(item.firstExpectedDate)!,
    frequency: item.frequency,
    customInterval: item.customInterval,
    currency,
    transactionCount: item._count.transactions,
    buckets: item.buckets.map((b) => ({
      id: b.id,
      sequence: b.sequence,
      startDate: day(b.startDate)!,
      endDate: day(b.endDate)!,
      expectedDate: day(b.expectedDate)!,
      estimatedAmount: money(b.estimatedAmount),
      actualAmount: money(b.actualAmount),
      actualDate: day(b.actualDate),
      currency,
      status: bucketStatus(b.endDate, b.actualAmount, today),
    })),
  };
}

type ScheduleInput = {
  startDate?: string;
  endDate?: string;
  firstExpectedDate: string;
  frequency: Frequency;
  customInterval?: number | null;
};

/** Defaults dates to the budget and clamps them into it (FR-013), returning notices for the user. */
export function resolveSchedule(budget: { startDate: Date; endDate: Date }, input: ScheduleInput) {
  const bs = toPlainDate(budget.startDate);
  const be = toPlainDate(budget.endDate);
  const cmp = Temporal.PlainDate.compare;
  const notices: Notice[] = [];
  let start = input.startDate ? Temporal.PlainDate.from(input.startDate) : bs;
  let end = input.endDate ? Temporal.PlainDate.from(input.endDate) : be;
  if (cmp(start, bs) < 0) {
    start = bs;
    notices.push({
      code: "START_CLAMPED",
      message: `The start date was set to ${pretty(bs)}, the start of the budget.`,
    });
  }
  if (cmp(end, be) > 0) {
    end = be;
    notices.push({
      code: "END_CLAMPED",
      message: `The end date was set to ${pretty(be)}, the end of the budget.`,
    });
  }
  if (cmp(start, be) > 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Please check the highlighted fields.", {
      startDate: "The start date must be within the budget.",
    });
  }
  if (cmp(end, start) < 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Please check the highlighted fields.", {
      endDate: "The end date must be on or after the start date.",
    });
  }
  const first = Temporal.PlainDate.from(input.firstExpectedDate);
  if (cmp(first, start) < 0 || cmp(first, end) > 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Please check the highlighted fields.", {
      firstExpectedDate: `The first expected date must be between ${pretty(start)} and ${pretty(end)}.`,
    });
  }
  const schedule: ItemSchedule = {
    startDate: start,
    endDate: end,
    firstExpectedDate: first,
    frequency: input.frequency,
    customInterval: input.frequency.startsWith("CUSTOM_") ? input.customInterval : null,
  };
  return { schedule, notices };
}

/** Rebuilds buckets and moves existing transactions into them (FR-025). */
export async function writeBuckets(
  tx: Tx,
  itemId: string,
  schedule: ItemSchedule,
  estimatedAmount: string,
) {
  const ranges = generateBuckets(schedule);
  const old = await tx.bucket.findMany({ where: { itemId }, select: { id: true } });
  // Negative sequences avoid clashing with the old rows until they are removed.
  await tx.bucket.createMany({
    data: ranges.map((r) => ({
      itemId,
      sequence: -r.sequence,
      startDate: fromPlainDate(r.startDate),
      endDate: fromPlainDate(r.endDate),
      expectedDate: fromPlainDate(r.expectedDate),
      estimatedAmount,
    })),
  });
  const created = (await tx.bucket.findMany({ where: { itemId, sequence: { lt: 0 } } })).map(
    (b) => ({
      id: b.id,
      startDate: toPlainDate(b.startDate),
      endDate: toPlainDate(b.endDate),
    }),
  );

  const txns = await tx.transaction.findMany({
    where: { itemId },
    select: { id: true, localDate: true },
  });
  const moves = new Map<string, string[]>();
  for (const t of txns) {
    const target = findBucket(created, toPlainDate(t.localDate));
    if (!target) throw conflict("A transaction would fall outside the item's dates.");
    moves.set(target.id, [...(moves.get(target.id) ?? []), t.id]);
  }
  for (const [bucketId, ids] of moves) {
    await tx.transaction.updateMany({ where: { id: { in: ids } }, data: { bucketId } });
  }
  if (old.length) await tx.bucket.deleteMany({ where: { id: { in: old.map((b) => b.id) } } });
  await tx.bucket.updateMany({ where: { itemId }, data: { sequence: { multiply: -1 } } });
  await recomputeBucketActuals(tx, moves.keys());
}

async function loadItem(id: string, db: Tx | typeof prisma = prisma) {
  return db.budgetItem.findUniqueOrThrow({
    where: { id },
    include: { ...itemInclude, category: { include: { budget: true } } },
  });
}

export async function createItem(
  user: SessionUser,
  categoryId: string,
  data: z.output<typeof createItemSchema>,
) {
  const category = await ownedCategory(user.id, categoryId);
  const { schedule, notices } = resolveSchedule(category.budget, data);
  const id = await prisma.$transaction(
    async (tx) => {
      const item = await tx.budgetItem.create({
        data: {
          categoryId,
          name: data.name,
          description: data.description,
          estimatedAmount: data.estimatedAmount,
          frequency: schedule.frequency,
          customInterval: schedule.customInterval ?? null,
          startDate: fromPlainDate(schedule.startDate),
          endDate: fromPlainDate(schedule.endDate),
          firstExpectedDate: fromPlainDate(schedule.firstExpectedDate),
        },
      });
      await writeBuckets(tx, item.id, schedule, data.estimatedAmount);
      return item.id;
    },
    { timeout: 20000 },
  );
  return { data: serializeItem(await loadItem(id), todayIn(user.timezone)), notices };
}

export async function getItem(user: SessionUser, id: string) {
  await ownedItem(user.id, id);
  return serializeItem(await loadItem(id), todayIn(user.timezone));
}

export async function updateItem(
  user: SessionUser,
  id: string,
  data: z.output<typeof updateItemSchema>,
) {
  const item = await ownedItem(user.id, id);

  if (data.categoryId && data.categoryId !== item.categoryId) {
    const target = await prisma.category.findFirst({
      where: { id: data.categoryId, budget: { userId: user.id } },
    });
    if (
      !target ||
      target.budgetId !== item.category.budgetId ||
      target.type !== item.category.type
    ) {
      throw new AppError(422, "VALIDATION_ERROR", "Please check the highlighted fields.", {
        categoryId: "Items can only move to another category of the same type in the same budget.",
      });
    }
  }

  const frequency = (data.frequency ?? item.frequency) as Frequency;
  const { schedule, notices } = resolveSchedule(item.category.budget, {
    startDate: data.startDate ?? day(item.startDate)!,
    endDate: data.endDate ?? day(item.endDate)!,
    firstExpectedDate: data.firstExpectedDate ?? day(item.firstExpectedDate)!,
    frequency,
    customInterval: data.customInterval !== undefined ? data.customInterval : item.customInterval,
  });
  if (frequency.startsWith("CUSTOM_") && !schedule.customInterval) {
    throw new AppError(422, "VALIDATION_ERROR", "Please check the highlighted fields.", {
      customInterval: "Enter how often it repeats.",
    });
  }
  const estimatedAmount = data.estimatedAmount ?? money(item.estimatedAmount);

  const outside = await prisma.transaction.count({
    where: {
      itemId: id,
      OR: [
        { localDate: { lt: fromPlainDate(schedule.startDate) } },
        { localDate: { gt: fromPlainDate(schedule.endDate) } },
      ],
    },
  });
  if (outside > 0) {
    throw conflict(
      `${outside} transaction(s) would fall outside the new dates. Move or delete them first.`,
    );
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.budgetItem.update({
        where: { id },
        data: {
          categoryId: data.categoryId,
          name: data.name,
          description: data.description,
          estimatedAmount,
          frequency,
          customInterval: schedule.customInterval ?? null,
          startDate: fromPlainDate(schedule.startDate),
          endDate: fromPlainDate(schedule.endDate),
          firstExpectedDate: fromPlainDate(schedule.firstExpectedDate),
        },
      });
      await writeBuckets(tx, id, schedule, estimatedAmount);
    },
    { timeout: 20000 },
  );
  return { data: serializeItem(await loadItem(id), todayIn(user.timezone)), notices };
}

export async function deleteItem(userId: string, id: string) {
  await ownedItem(userId, id);
  await prisma.$transaction(async (tx) => {
    const accounts = await tx.transaction.findMany({
      where: { itemId: id },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    await tx.budgetItem.delete({ where: { id } });
    await recalcAccountBalances(
      tx,
      accounts.map((a) => a.accountId),
    );
  });
}
