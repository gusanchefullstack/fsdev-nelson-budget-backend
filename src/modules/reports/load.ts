import type { InsightItem } from "../../domain/insights.js";
import { prisma } from "../../lib/prisma.js";
import { money } from "../../lib/serialize.js";
import { toPlainDate } from "../../lib/temporal.js";

/** Items with their buckets, shaped for the pure insight calculations. */
export async function loadInsightItems(where: { userId: string; budgetId?: string }) {
  const items = await prisma.budgetItem.findMany({
    where: { category: { budget: { userId: where.userId }, budgetId: where.budgetId } },
    include: {
      buckets: { orderBy: { sequence: "asc" } },
      category: {
        select: {
          id: true,
          name: true,
          type: true,
          budgetId: true,
          budget: { select: { currency: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return items.map((i) => ({
    budgetId: i.category.budgetId,
    budgetName: i.category.budget.name,
    currency: i.category.budget.currency,
    categoryId: i.category.id,
    insight: {
      id: i.id,
      name: i.name,
      categoryName: i.category.name,
      type: i.category.type,
      buckets: i.buckets.map((b) => ({
        id: b.id,
        startDate: toPlainDate(b.startDate),
        endDate: toPlainDate(b.endDate),
        estimatedAmount: money(b.estimatedAmount),
        actualAmount: money(b.actualAmount),
      })),
    } satisfies InsightItem,
  }));
}
