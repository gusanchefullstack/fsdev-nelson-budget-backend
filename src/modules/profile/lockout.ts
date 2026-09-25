import { APIError } from "better-auth/api";
import { prisma } from "../../lib/prisma.js";

// FR-005a: 5 failed sign-ins per account or per IP → refused for 15 minutes from the 5th failure.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
export const SIGN_IN_PATHS = new Set(["/sign-in/email", "/sign-in/username"]);

export function clientIp(headers: Headers | undefined): string | undefined {
  return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

// The same person may type an email or a username; both map to one account key.
async function accountKey(body: {
  email?: string;
  username?: string;
}): Promise<string | undefined> {
  const identifier = (body.email ?? body.username ?? "").trim().toLowerCase();
  if (!identifier) return undefined;
  const user = await prisma.user.findFirst({
    where: body.email ? { email: identifier } : { username: identifier },
    select: { id: true },
  });
  return `signin-fail:account:${user?.id ?? identifier}`;
}

export async function lockoutKeys(body: { email?: string; username?: string }, headers?: Headers) {
  const ip = clientIp(headers);
  const account = await accountKey(body);
  return { account, ip: ip ? `signin-fail:ip:${ip}` : undefined };
}

export async function assertNotLocked(keys: (string | undefined)[]) {
  const now = Date.now();
  const rows = await prisma.rateLimit.findMany({
    where: { key: { in: keys.filter(Boolean) as string[] } },
  });
  if (rows.some((r) => r.count >= MAX_FAILURES && now - Number(r.lastRequest) < WINDOW_MS)) {
    throw new APIError("TOO_MANY_REQUESTS", {
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Please try again in 15 minutes.",
    });
  }
}

export async function recordFailure(keys: (string | undefined)[]) {
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    const row = await prisma.rateLimit.findUnique({ where: { key } });
    const fresh = !row || now - Number(row.lastRequest) >= WINDOW_MS;
    await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, lastRequest: BigInt(now) },
      update: { count: fresh ? 1 : { increment: 1 }, lastRequest: BigInt(now) },
    });
  }
}

export async function clearFailures(key: string | undefined) {
  if (key) await prisma.rateLimit.deleteMany({ where: { key } });
}
