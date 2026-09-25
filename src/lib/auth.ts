import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { zodFields } from "./errors.js";
import { sendEmail } from "./email.js";
import { prisma } from "./prisma.js";
import { signUpSchema } from "../modules/profile/schemas.js";
import {
  SIGN_IN_PATHS,
  assertNotLocked,
  clearFailures,
  lockoutKeys,
  recordFailure,
} from "../modules/profile/lockout.js";

const required = (type: "string") => ({ type, required: true, input: true }) as const;
const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:5173";

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
    resetPasswordTokenExpiresIn: 3600, // FR-003a: 1 hour, single use
    sendResetPassword: async ({ user, token }) => {
      await sendEmail(
        user.email,
        "Reset your Nelson password",
        `Use this link within 1 hour to choose a new password:\n\n${appUrl()}/reset-password?token=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
      );
    },
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
    // FR-004: email is editable; no verification in v0.1
    changeEmail: { enabled: true, updateEmailWithoutVerification: true },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    customRules: {
      // Sign-in failures are handled by the account/IP lockout below.
      "/sign-in/email": false,
      "/sign-in/username": false,
      "/sign-up/email": { window: 3600, max: 5 },
      "/request-password-reset": { window: 3600, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const parsed = signUpSchema.safeParse(ctx.body);
        if (!parsed.success) {
          throw new APIError("UNPROCESSABLE_ENTITY", {
            code: "VALIDATION_ERROR",
            message: "Please check the highlighted fields.",
            fields: zodFields(parsed.error),
          });
        }
        ctx.body.name = `${parsed.data.firstName} ${parsed.data.lastName}`;
        // FR-002: say which field is taken instead of a generic error
        const taken = await prisma.user.findMany({
          where: {
            OR: [
              { email: parsed.data.email.toLowerCase() },
              { username: parsed.data.username.toLowerCase() },
            ],
          },
          select: { email: true, username: true },
        });
        const fields: Record<string, string> = {};
        if (taken.some((u) => u.email === parsed.data.email.toLowerCase()))
          fields.email = "That email is already in use.";
        if (taken.some((u) => u.username === parsed.data.username.toLowerCase()))
          fields.username = "That username is taken.";
        if (Object.keys(fields).length) {
          throw new APIError("UNPROCESSABLE_ENTITY", {
            code: "VALIDATION_ERROR",
            message: "Please check the highlighted fields.",
            fields,
          });
        }
      }
      if (ctx.path === "/change-email") {
        const newEmail = String(ctx.body?.newEmail ?? "").toLowerCase();
        if (
          newEmail &&
          (await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } }))
        ) {
          throw new APIError("UNPROCESSABLE_ENTITY", {
            code: "VALIDATION_ERROR",
            message: "Please check the highlighted fields.",
            fields: { newEmail: "That email is already in use." },
          });
        }
      }
      if (SIGN_IN_PATHS.has(ctx.path)) {
        const keys = await lockoutKeys(ctx.body ?? {}, ctx.headers);
        await assertNotLocked([keys.account, keys.ip]);
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (!SIGN_IN_PATHS.has(ctx.path)) return;
      const keys = await lockoutKeys(ctx.body ?? {}, ctx.headers);
      const failed = ctx.context.returned instanceof APIError;
      if (failed) await recordFailure([keys.account, keys.ip]);
      else await clearFailures(keys.account);
    }),
  },
});
