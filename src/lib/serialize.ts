import type { Prisma } from "../generated/prisma/client.js";

type Decimalish = Prisma.Decimal | { toFixed(n: number): string } | number | string;

/** Money leaves the API as a 2-decimal string ("5000.00"). */
export const money = (value: Decimalish | null | undefined): string =>
  value === null || value === undefined
    ? "0.00"
    : typeof value === "object"
      ? value.toFixed(2)
      : Number(value).toFixed(2);

/** `@db.Date` columns leave the API as "YYYY-MM-DD". */
export const day = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
