import { z } from "zod";
import { money, name80, plainDate } from "../../lib/validate.js";

const FREQUENCIES = [
  "ONE_TIME",
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
  "CUSTOM_DAYS",
  "CUSTOM_MONTHS",
] as const;

const itemFields = {
  name: name80,
  description: z.string().trim().min(1, "Required.").max(500, "Use 500 characters or fewer."),
  startDate: plainDate.optional(),
  endDate: plainDate.optional(),
  estimatedAmount: money,
  firstExpectedDate: plainDate,
  frequency: z.enum(FREQUENCIES, "Choose a frequency."),
  customInterval: z.coerce.number().int().min(1, "Use 1 or more.").nullish(),
};

// customInterval is required (≥ 1) only for custom frequencies (FR-014)
function checkInterval(
  v: { frequency?: string; customInterval?: number | null },
  ctx: z.RefinementCtx,
) {
  if (!v.frequency) return;
  const custom = v.frequency.startsWith("CUSTOM_");
  if (custom && !v.customInterval) {
    ctx.addIssue({
      code: "custom",
      path: ["customInterval"],
      message: "Enter how often it repeats.",
    });
  }
  if (!custom && v.customInterval) {
    ctx.addIssue({
      code: "custom",
      path: ["customInterval"],
      message: "Only custom frequencies take an interval.",
    });
  }
}

export const createItemSchema = z.object(itemFields).superRefine(checkInterval);

export const updateItemSchema = z
  .object({ ...itemFields, categoryId: z.string().min(1) })
  .partial()
  .superRefine(checkInterval);
