import { z } from "zod";
import { countryCode, ianaTimezone, phoneCountryCode, phoneNumber } from "../../lib/validate.js";

const person = z.string().trim().min(1, "Required.").max(60, "Use 60 characters or fewer.");
const requiredText = (max: number) => z.string().trim().min(1, "Required.").max(max);

// Profile rules from data-model.md (FR-001)
export const profileFields = {
  firstName: person,
  lastName: person,
  address: requiredText(200),
  city: requiredText(100),
  postalCode: requiredText(20),
  state: requiredText(100),
  country: countryCode,
  phoneCountryCode,
  phoneNumber,
  timezone: ianaTimezone,
};

export const signUpSchema = z.object({
  ...profileFields,
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.]{3,30}$/, "Use 3–30 letters, numbers, underscores or dots."),
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
  name: z.string().optional(),
});

export const updateProfileSchema = z
  .object({
    ...profileFields,
    themePreference: z.enum(["SYSTEM", "LIGHT", "DARK"]),
    onboardingStatus: z.enum(
      ["COMPLETED", "SKIPPED"],
      "Onboarding can only be completed or skipped.",
    ),
  })
  .partial();
