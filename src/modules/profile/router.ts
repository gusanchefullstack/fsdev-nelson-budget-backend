import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import { updateProfileSchema } from "./schemas.js";
import { getProfile, updateProfile } from "./service.js";

export const profileRouter = Router();

profileRouter.get("/me", async (_req, res) => {
  res.json({ data: await getProfile(currentUser(res).id) });
});

profileRouter.patch(
  "/me",
  (req, _res, next) => {
    // Username never changes; email changes go through Better Auth's /change-email.
    const fields: Record<string, string> = {};
    if (req.body?.username !== undefined) fields.username = "Your username can't be changed.";
    if (req.body?.email !== undefined)
      fields.email = "Use the change-email option to update your email.";
    if (Object.keys(fields).length)
      throw new AppError(422, "VALIDATION_ERROR", "Please check the highlighted fields.", fields);
    next();
  },
  validate(updateProfileSchema),
  async (_req, res) => {
    res.json({ data: await updateProfile(currentUser(res).id, res.locals.body) });
  },
);
