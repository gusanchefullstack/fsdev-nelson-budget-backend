import { Prisma } from "../generated/prisma/client.js";
import type { Tx } from "./prisma.js";

// currentBalance = openingBalance + Σ income − Σ expense (FR-030a)
export async function recalcAccountBalances(tx: Tx, accountIds: Iterable<string>) {
  for (const id of new Set(accountIds)) {
    const account = await tx.moneyAccount.findUnique({
      where: { id },
      select: { openingBalance: true },
    });
    if (!account) continue;
    const sums = await tx.transaction.groupBy({
      by: ["type"],
      where: { accountId: id },
      _sum: { amount: true },
    });
    let balance = new Prisma.Decimal(account.openingBalance);
    for (const s of sums) {
      const amount = s._sum.amount ?? new Prisma.Decimal(0);
      balance = s.type === "INCOME" ? balance.plus(amount) : balance.minus(amount);
    }
    await tx.moneyAccount.update({ where: { id }, data: { currentBalance: balance } });
  }
}
