import "temporal-polyfill/global";
import { describe, expect, it } from "vitest";
import {
  bucketFigures,
  budgetInsights,
  itemMetrics,
  type InsightItem,
} from "../../src/domain/insights.js";

const d = (s: string) => Temporal.PlainDate.from(s);

// Rent: monthly on the 20th, 5,000 per bucket (Jan 1–Feb 4, Feb 5–Mar 4, Mar 5–Apr 4, Apr 5–May 4 …)
function rent(actuals: string[], over: Partial<InsightItem> = {}): InsightItem {
  const ranges = [
    ["2027-01-01", "2027-02-04"],
    ["2027-02-05", "2027-03-04"],
    ["2027-03-05", "2027-04-04"],
    ["2027-04-05", "2027-05-04"],
  ];
  return {
    id: "rent",
    name: "Rent",
    categoryName: "Housing",
    type: "EXPENSE",
    buckets: ranges.map(([start, end], i) => ({
      id: `b${i + 1}`,
      startDate: d(start!),
      endDate: d(end!),
      estimatedAmount: "5000.00",
      actualAmount: actuals[i] ?? "0.00",
    })),
    ...over,
  };
}

describe("itemMetrics", () => {
  it("estimated to date counts buckets that have started", () => {
    const m = itemMetrics(rent([]), d("2027-02-18"));
    expect(m.estimatedToDate).toBe("10000.00");
  });

  it("ratio is 1 when no bucket is closed", () => {
    const m = itemMetrics(rent([]), d("2027-01-10"));
    expect(m.ratio).toBe(1);
  });

  it("projects actual + unpaid remaining estimates × ratio, never counting a paid bucket twice", () => {
    // Today Feb 20: bucket #1 closed and missed (0), bucket #2 paid early (5,000), #3–#4 upcoming
    const m = itemMetrics(rent(["0.00", "5000.00"]), d("2027-02-20"));
    expect(m.actualToDate).toBe("5000.00");
    expect(m.ratio).toBe(0); // closed bucket #1: 0 / 5,000
    expect(m.projected).toBe("5000.00"); // remaining #3, #4 × 0
    const healthy = itemMetrics(rent(["5000.00", "5000.00"]), d("2027-02-20"));
    expect(healthy.projected).toBe("20000.00"); // 10,000 actual + 10,000 remaining × 1 (not 25,000)
  });

  it("uses the closed-bucket ratio for the remaining buckets", () => {
    const m = itemMetrics(rent(["5500.00", "5500.00"]), d("2027-03-10"));
    expect(m.ratio).toBeCloseTo(1.1);
    expect(m.projected).toBe("22000.00"); // 11,000 + 10,000 × 1.1
    expect(m.recommended).toBe("5500.00");
  });

  it("lists missed buckets and flags over-budget expenses only", () => {
    const m = itemMetrics(rent(["0.00", "12000.00"]), d("2027-02-20"));
    expect(m.missedBucketIds).toEqual(["b1"]);
    expect(m.overBudget).toBe(true);
    const income = itemMetrics(rent(["0.00", "12000.00"], { type: "INCOME" }), d("2027-02-20"));
    expect(income.overBudget).toBe(false);
  });

  it("has no recommendation without closed buckets", () => {
    expect(itemMetrics(rent([]), d("2027-01-10")).recommended).toBeNull();
  });
});

describe("budgetInsights (FR-048, FR-049)", () => {
  const salary: InsightItem = {
    ...rent(["4000.00", "4000.00"]),
    id: "salary",
    name: "Salary",
    categoryName: "Salaries",
    type: "INCOME",
  };

  it("suggests on expenses over 10% and income under 10%, and reports the projected net", () => {
    const today = d("2027-03-10");
    const { suggestions, recommendations } = budgetInsights(
      [rent(["5600.00", "5600.00"]), salary],
      today,
      "USD",
    );
    const rules = suggestions.map((s) => s.rule);
    expect(rules).toContain("EXPENSE_OVER_ESTIMATE");
    expect(rules).toContain("INCOME_UNDER_ESTIMATE");
    expect(rules).toContain("PROJECTED_DEFICIT");
    expect(suggestions.find((s) => s.rule === "EXPENSE_OVER_ESTIMATE")?.message).toContain("Rent");
    expect(recommendations).toEqual([
      { itemId: "rent", itemName: "Rent", recommendedAmount: "5600.00" },
      { itemId: "salary", itemName: "Salary", recommendedAmount: "4000.00" },
    ]);
  });

  it("flags items with missed buckets", () => {
    const { suggestions } = budgetInsights([rent(["0.00"])], d("2027-02-20"), "USD");
    expect(suggestions.some((s) => s.rule === "MISSED_PAYMENTS" && s.itemId === "rent")).toBe(true);
  });

  it("does not flag a 10% difference exactly", () => {
    const { suggestions } = budgetInsights([rent(["5500.00", "5500.00"])], d("2027-03-10"), "USD");
    expect(suggestions.some((s) => s.rule === "EXPENSE_OVER_ESTIMATE")).toBe(false);
  });
});

describe("bucketFigures", () => {
  const buckets = rent(["5000.00", "0.00", "0.00", "1200.50"]).buckets;

  it("counts nothing to date before the budget starts", () => {
    expect(bucketFigures(buckets, d("2026-12-31"))).toEqual({
      estimatedTotal: 2_000_000,
      estimatedToDate: 0,
      actual: 620_050,
    });
  });

  it("counts buckets that have started, including one starting today", () => {
    expect(bucketFigures(buckets, d("2027-03-05")).estimatedToDate).toBe(1_500_000);
    expect(bucketFigures(buckets, d("2027-03-04")).estimatedToDate).toBe(1_000_000);
  });

  it("counts the whole estimate once the budget has ended", () => {
    const f = bucketFigures(buckets, d("2028-01-01"));
    expect(f.estimatedToDate).toBe(f.estimatedTotal);
  });

  it("adds actuals from every bucket, future ones included", () => {
    expect(bucketFigures(buckets, d("2027-01-10")).actual).toBe(620_050);
  });

  it("adds in exact cents", () => {
    const f = bucketFigures(
      [
        { startDate: d("2027-01-01"), estimatedAmount: "0.10", actualAmount: "0.10" },
        { startDate: d("2027-01-02"), estimatedAmount: "0.20", actualAmount: "0.20" },
      ],
      d("2027-02-01"),
    );
    expect(f).toEqual({ estimatedTotal: 30, estimatedToDate: 30, actual: 30 });
  });

  it("is all zeros with no buckets", () => {
    expect(bucketFigures([], d("2027-01-01"))).toEqual({
      estimatedTotal: 0,
      estimatedToDate: 0,
      actual: 0,
    });
  });
});
