import { z } from "zod";
import { currency, description500, name80, plainDate } from "../../lib/validate.js";

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

export const createBudgetSchema = z
  .object({
    name: name80,
    description: description500.nullish(),
    currency,
    startDate: plainDate,
    endDate: plainDate,
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
