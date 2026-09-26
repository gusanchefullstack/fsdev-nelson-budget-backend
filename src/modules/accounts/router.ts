import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import { createAccountSchema, updateAccountSchema } from "./schemas.js";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "./service.js";

export const accountsRouter = Router();

accountsRouter.get("/accounts", async (_req, res) => {
  res.json({ data: await listAccounts(currentUser(res).id) });
});
accountsRouter.post("/accounts", validate(createAccountSchema), async (_req, res) => {
  res.status(201).json({ data: await createAccount(currentUser(res).id, res.locals.body) });
});
accountsRouter.get("/accounts/:id", async (req, res) => {
  res.json({ data: await getAccount(currentUser(res).id, String(req.params.id)) });
});
accountsRouter.patch("/accounts/:id", validate(updateAccountSchema), async (req, res) => {
  res.json({
    data: await updateAccount(currentUser(res).id, String(req.params.id), res.locals.body),
  });
});
accountsRouter.delete("/accounts/:id", async (req, res) => {
  await deleteAccount(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});
