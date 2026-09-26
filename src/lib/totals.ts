import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";
import { money } from "./serialize.js";

export type BudgetTotals = {
  estimatedIncomeToDate: string;
  actualIncome: string;
  estimatedExpenseToDate: string;
  actualExpense: string;
};

/** Estimated to date counts buckets that have started (startDate ≤ today); actuals count everything. */
export async function budgetTotals(
  budgetIds: string[],
  today: string,
): Promise<Map<string, BudgetTotals>> {
  const result = new Map<string, BudgetTotals>();
  for (const id of budgetIds) {
    result.set(id, {
      estimatedIncomeToDate: "0.00",
      actualIncome: "0.00",
      estimatedExpenseToDate: "0.00",
      actualExpense: "0.00",
    });
  }
  if (budgetIds.length === 0) return result;
  const rows = await prisma.$queryRaw<
    { budgetId: string; type: string; estimated: Prisma.Decimal; actual: Prisma.Decimal }[]
  >`
    SELECT c."budgetId", c."type"::text AS "type",
      COALESCE(SUM(b."estimatedAmount") FILTER (WHERE b."startDate" <= ${today}::date), 0) AS "estimated",
      COALESCE(SUM(b."actualAmount"), 0) AS "actual"
    FROM "Bucket" b
    JOIN "BudgetItem" i ON i."id" = b."itemId"
    JOIN "Category" c ON c."id" = i."categoryId"
    WHERE c."budgetId" IN (${Prisma.join(budgetIds)})
    GROUP BY c."budgetId", c."type"`;
  for (const r of rows) {
    const t = result.get(r.budgetId)!;
    if (r.type === "INCOME") {
      t.estimatedIncomeToDate = money(r.estimated);
      t.actualIncome = money(r.actual);
    } else {
      t.estimatedExpenseToDate = money(r.estimated);
      t.actualExpense = money(r.actual);
    }
  }
  return result;
}
