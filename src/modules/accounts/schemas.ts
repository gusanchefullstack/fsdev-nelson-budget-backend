import { z } from "zod";
import {
  currency,
  description500,
  name80,
  optionalContact,
  signedMoney,
} from "../../lib/validate.js";

const accountType = z.enum(
  ["CHECKING", "SAVINGS", "CREDIT_CARD", "BROKERAGE", "WALLET", "CASH"],
  "Choose an account type.",
);

// currentBalance is never accepted from clients (FR-030a); unknown keys are stripped.
export const createAccountSchema = z.object({
  name: name80,
  description: description500.nullish(),
  type: accountType,
  currency,
  openingBalance: signedMoney,
  ...optionalContact,
});

export const updateAccountSchema = createAccountSchema.partial();
