import { z } from "zod";
import { description500, name80 } from "../../lib/validate.js";

const type = z.enum(["INCOME", "EXPENSE"], "Choose income or expense.");

export const createCategorySchema = z.object({
  type,
  name: name80,
  description: description500.nullish(),
});
export const updateCategorySchema = createCategorySchema.partial();
