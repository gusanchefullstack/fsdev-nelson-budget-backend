import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { prisma } from "./prisma.js";

const required = (type: "string") => ({ type, required: true, input: true }) as const;

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  basePath: "/api/auth",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: false,
  },
  plugins: [username()],
  user: {
    // Profile fields collected at sign-up (FR-001)
    additionalFields: {
      firstName: required("string"),
      lastName: required("string"),
      address: required("string"),
      city: required("string"),
      postalCode: required("string"),
      state: required("string"),
      country: required("string"),
      phoneCountryCode: required("string"),
      phoneNumber: required("string"),
      timezone: required("string"),
      themePreference: { type: "string", required: false, input: false },
      onboardingStatus: { type: "string", required: false, input: false },
    },
  },
});
