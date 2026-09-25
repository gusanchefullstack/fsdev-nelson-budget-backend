import { Prisma } from "../generated/prisma/client.js";
import type { Tx } from "./prisma.js";

// actualAmount = Σ transactions (0 if none); actualDate = latest local date or null (FR-024)
export async function recomputeBucketActuals(tx: Tx, bucketIds: Iterable<string>) {
  for (const id of new Set(bucketIds)) {
    const agg = await tx.transaction.aggregate({
      where: { bucketId: id },
      _sum: { amount: true },
      _max: { localDate: true },
    });
    await tx.bucket.updateMany({
      where: { id },
      data: {
        actualAmount: agg._sum.amount ?? new Prisma.Decimal(0),
        actualDate: agg._max.localDate ?? null,
      },
    });
  }
}
