import { itemMetrics } from "../../domain/insights.js";
import { prisma } from "../../lib/prisma.js";
import type { SessionUser } from "../../lib/session.js";
import { todayIn } from "../../lib/temporal.js";
import { listBudgets } from "../budgets/service.js";
import { loadInsightItems } from "../reports/load.js";
import { serializeTransaction } from "../transactions/service.js";

const usDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const pretty = (d: Temporal.PlainDate) => usDate.format(new Date(`${d.toString()}T00:00:00Z`));
const fmtMoney = (v: string, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(
    Number(v),
  );

/** FR-044: per-budget totals, the latest 10 transactions and alerts. */
export async function dashboard(user: SessionUser) {
  const today = todayIn(user.timezone);
  const budgets = (await listBudgets(user)).map((b) => ({
    ...b,
    net: (Number(b.actualIncome) - Number(b.actualExpense)).toFixed(2),
  }));

  const latest = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 10,
    include: {
      item: {
        select: {
          name: true,
          category: { select: { budgetId: true, budget: { select: { name: true } } } },
        },
      },
      account: { select: { name: true } },
      payor: { select: { name: true } },
      vendor: { select: { name: true } },
    },
  });

  const alerts: {
    type: "MISSED" | "OVER_BUDGET";
    budgetId: string;
    itemId: string;
    bucketId?: string;
    message: string;
  }[] = [];
  for (const { insight, budgetId, currency } of await loadInsightItems({ userId: user.id })) {
    const m = itemMetrics(insight, today);
    for (const bucketId of m.missedBucketIds) {
      const b = insight.buckets.find((x) => x.id === bucketId)!;
      alerts.push({
        type: "MISSED",
        budgetId,
        itemId: insight.id,
        bucketId,
        message: `${insight.name}: no transaction recorded for ${pretty(b.startDate)} – ${pretty(b.endDate)}.`,
      });
    }
    if (m.overBudget) {
      alerts.push({
        type: "OVER_BUDGET",
        budgetId,
        itemId: insight.id,
        message: `${insight.name} is over budget: ${fmtMoney(m.actualToDate, currency)} spent vs ${fmtMoney(m.estimatedToDate, currency)} estimated to date.`,
      });
    }
  }

  return { budgets, latestTransactions: latest.map(serializeTransaction), alerts };
}
