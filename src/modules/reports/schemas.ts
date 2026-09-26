import { z } from "zod";
import { plainDate } from "../../lib/validate.js";

export const rangeSchema = z.object({ from: plainDate.optional(), to: plainDate.optional() });

export const byEntitySchema = rangeSchema.extend({
  dimension: z.enum(["account", "payor", "vendor"], "Choose account, payor or vendor."),
  budgetId: z.string().min(1, "Choose a budget."),
});

export const topSchema = z.object({
  n: z.coerce
    .number()
    .default(5)
    .refine((n) => [5, 10, 20].includes(n), "Choose 5, 10 or 20."),
});
