import { z } from "zod";
import { currency, description500, name80, plainDate } from "../../lib/validate.js";
import { createItemSchema } from "../items/schemas.js";

const endAfterStart = (v: { startDate?: string; endDate?: string }) =>
  !v.startDate || !v.endDate || v.endDate > v.startDate;
// `when` keeps this check running even if other fields (e.g. name) are invalid.
const endAfterStartIssue = {
  message: "The end date must be after the start date.",
  path: ["endDate"],
  when: ({ value }: { value: unknown }) => {
    const v = value as { startDate?: unknown; endDate?: unknown };
    return typeof v?.startDate === "string" && typeof v?.endDate === "string";
  },
};

// Guided and Complete modes send the whole tree at once (FR-016).
const nestedCategory = z.object({
  type: z.enum(["INCOME", "EXPENSE"], "Choose income or expense."),
  name: name80,
  description: description500.nullish(),
  items: z.array(createItemSchema).max(200).default([]),
});

export const createBudgetSchema = z
  .object({
    name: name80,
    description: description500.nullish(),
    currency,
    startDate: plainDate,
    endDate: plainDate,
    categories: z.array(nestedCategory).max(100).optional(),
  })
  .refine(endAfterStart, endAfterStartIssue);

export const updateBudgetSchema = z
  .object({
    name: name80,
    description: description500.nullish(),
    currency,
    startDate: plainDate,
    endDate: plainDate,
  })
  .partial()
  .refine(endAfterStart, endAfterStartIssue);
