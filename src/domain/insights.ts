import "temporal-polyfill/global";

export type InsightBucket = {
  id: string;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  estimatedAmount: string;
  actualAmount: string;
};

export type InsightItem = {
  id: string;
  name: string;
  categoryName: string;
  type: "INCOME" | "EXPENSE";
  buckets: InsightBucket[];
};

// Money is handled in integer cents to keep totals exact (SC-009).
const cents = (v: string) => Math.round(Number(v) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);
const cmp = Temporal.PlainDate.compare;

/** Full-period estimate, estimate to date (buckets started by today) and actual, in cents. */
export function bucketFigures(
  buckets: Pick<InsightBucket, "startDate" | "estimatedAmount" | "actualAmount">[],
  today: Temporal.PlainDate,
) {
  let estimatedTotal = 0;
  let estimatedToDate = 0;
  let actual = 0;
  for (const b of buckets) {
    const est = cents(b.estimatedAmount);
    estimatedTotal += est;
    if (cmp(b.startDate, today) <= 0) estimatedToDate += est;
    actual += cents(b.actualAmount);
  }
  return { estimatedTotal, estimatedToDate, actual };
}

export function itemMetrics(item: InsightItem, today: Temporal.PlainDate) {
  let estimatedToDate = 0;
  let actualToDate = 0;
  let closedEstimated = 0;
  let closedActual = 0;
  let closedCount = 0;
  let remainingUnpaid = 0;
  const missedBucketIds: string[] = [];

  for (const b of item.buckets) {
    const est = cents(b.estimatedAmount);
    const act = cents(b.actualAmount);
    actualToDate += act;
    if (cmp(b.startDate, today) <= 0) estimatedToDate += est;
    if (cmp(b.endDate, today) < 0) {
      closedEstimated += est;
      closedActual += act;
      closedCount += 1;
      if (act === 0) missedBucketIds.push(b.id);
    } else if (act === 0) {
      // Still open or upcoming and not paid yet: this is what remains (FR-046).
      remainingUnpaid += est;
    }
  }

  const ratio = closedCount > 0 && closedEstimated > 0 ? closedActual / closedEstimated : 1;
  return {
    itemId: item.id,
    itemName: item.name,
    categoryName: item.categoryName,
    type: item.type,
    estimatedToDate: fmt(estimatedToDate),
    actualToDate: fmt(actualToDate),
    ratio,
    projected: fmt(actualToDate + Math.round(remainingUnpaid * ratio)),
    missedBucketIds,
    overBudget: item.type === "EXPENSE" && actualToDate > estimatedToDate,
    recommended: closedCount > 0 ? fmt(Math.round(closedActual / closedCount)) : null,
  };
}

export type Suggestion = { rule: string; itemId?: string; message: string };

const pct = (ratio: number) => `${Math.round(Math.abs(ratio - 1) * 100)}%`;
const money = (c: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(
    c / 100,
  );

/** Rule-based suggestions and future-budget recommendations (FR-048, FR-049). */
export function budgetInsights(items: InsightItem[], today: Temporal.PlainDate, currency: string) {
  const metrics = items.map((i) => itemMetrics(i, today));
  const suggestions: Suggestion[] = [];
  let projectedIncome = 0;
  let projectedExpense = 0;

  for (const m of metrics) {
    const hasClosed = m.recommended !== null;
    if (m.type === "EXPENSE") projectedExpense += cents(m.projected);
    else projectedIncome += cents(m.projected);

    if (hasClosed && m.type === "EXPENSE" && m.ratio > 1.1) {
      suggestions.push({
        rule: "EXPENSE_OVER_ESTIMATE",
        itemId: m.itemId,
        message: `${m.itemName} is running ${pct(m.ratio)} over its estimate. Consider cutting back or raising the estimate.`,
      });
    }
    if (hasClosed && m.type === "INCOME" && m.ratio < 0.9) {
      suggestions.push({
        rule: "INCOME_UNDER_ESTIMATE",
        itemId: m.itemId,
        message: `${m.itemName} is coming in ${pct(m.ratio)} under its estimate. Plan with the lower amount or look for the gap.`,
      });
    }
    if (m.missedBucketIds.length > 0) {
      const n = m.missedBucketIds.length;
      suggestions.push({
        rule: "MISSED_PAYMENTS",
        itemId: m.itemId,
        message: `${m.itemName} has ${n} past period${n === 1 ? "" : "s"} with no transaction recorded. Record it or adjust the item.`,
      });
    }
  }

  const net = projectedIncome - projectedExpense;
  if (items.length > 0) {
    suggestions.push(
      net >= 0
        ? {
            rule: "PROJECTED_SURPLUS",
            message: `You're on track to finish this budget with a surplus of ${money(net, currency)}. Consider saving or investing it.`,
          }
        : {
            rule: "PROJECTED_DEFICIT",
            message: `You're on track to finish this budget with a deficit of ${money(-net, currency)}. Look for expenses to reduce.`,
          },
    );
  }

  const recommendations = metrics
    .filter((m) => m.recommended !== null)
    .map((m) => ({ itemId: m.itemId, itemName: m.itemName, recommendedAmount: m.recommended! }));

  return { metrics, suggestions, recommendations, projectedNet: fmt(net) };
}
