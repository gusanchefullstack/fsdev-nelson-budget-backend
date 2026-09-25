import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { AppError } from "./errors.js";

export type SessionUser = { id: string; timezone: string };

// Loads the Better Auth session; every /api/v1 route needs one.
export const requireSession: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    next(new AppError(401, "UNAUTHENTICATED", "Please sign in to continue."));
    return;
  }
  res.locals.user = {
    id: session.user.id,
    timezone: (session.user as { timezone: string }).timezone,
  };
  next();
};

export function currentUser(res: { locals: Record<string, unknown> }): SessionUser {
  return res.locals.user as SessionUser;
}
