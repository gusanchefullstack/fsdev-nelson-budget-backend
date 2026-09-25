import "temporal-polyfill/global";
import type { RequestHandler } from "express";
import { z } from "zod";

type Source = "body" | "query" | "params";

// Parses req[source]; the parsed value is stored on res.locals[source] (Express 5 query is read-only).
export function validate(schema: z.ZodType, source: Source = "body"): RequestHandler {
  return (req, res, next) => {
    res.locals[source] = schema.parse(req[source] ?? {});
    next();
  };
}

const MONEY_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

export const signedMoney = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => MONEY_RE.test(v), "Enter an amount with up to 2 decimals.");

export const money = signedMoney.refine((v) => Number(v) > 0, "The amount must be greater than 0.");

export const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((v) => {
    try {
      return Temporal.PlainDate.from(v, { overflow: "reject" }).toString() === v;
    } catch {
      return false;
    }
  }, "Enter a valid date.");

export const currency = z.enum(["USD", "COP"]);

const timezones = new Set(Intl.supportedValuesOf("timeZone"));
export const ianaTimezone = z
  .string()
  .refine((tz) => timezones.has(tz) || tz === "UTC", "Choose a valid timezone.");

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const name80 = z.string().trim().min(1, "Required.").max(80, "Use 80 characters or fewer.");
export const description500 = z.string().trim().max(500, "Use 500 characters or fewer.");

export const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter country code (ISO 3166-1 alpha-2).");
export const phoneCountryCode = z
  .string()
  .trim()
  .regex(/^\+\d{1,3}$/, "Use + and 1–3 digits.");
export const phoneNumber = z
  .string()
  .trim()
  .regex(/^\d{4,15}$/, "Use 4–15 digits.");

// Optional contact fields shared by accounts, payors and vendors
export const optionalContact = {
  address: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  state: z.string().trim().max(100).nullish(),
  country: countryCode.nullish(),
  phoneCountryCode: phoneCountryCode.nullish(),
  phoneNumber: phoneNumber.nullish(),
};

export const idParam = z.object({ id: z.string().min(1) });
