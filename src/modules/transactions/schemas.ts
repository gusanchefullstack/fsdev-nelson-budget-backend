import { z } from "zod";
import { money, pagination, plainDate } from "../../lib/validate.js";

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a date and time.");

export const createTransactionSchema = z.object({
  itemId: z.string().min(1, "Choose a budget item."),
  amount: money,
  localDateTime,
  accountId: z.string().min(1, "Choose an account."),
  payorId: z.string().min(1).nullish(),
  vendorId: z.string().min(1).nullish(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export const listTransactionsSchema = pagination.extend({
  budgetId: z.string().optional(),
  itemId: z.string().optional(),
  accountId: z.string().optional(),
  payorId: z.string().optional(),
  vendorId: z.string().optional(),
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
  from: plainDate.optional(),
  to: plainDate.optional(),
});
