import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import {
  createTransactionSchema,
  listTransactionsSchema,
  updateTransactionSchema,
} from "./schemas.js";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "./service.js";

export const transactionsRouter = Router();

transactionsRouter.get(
  "/transactions",
  validate(listTransactionsSchema, "query"),
  async (_req, res) => {
    res.json(await listTransactions(currentUser(res).id, res.locals.query));
  },
);
transactionsRouter.post("/transactions", validate(createTransactionSchema), async (_req, res) => {
  res.status(201).json({ data: await createTransaction(currentUser(res), res.locals.body) });
});
transactionsRouter.get("/transactions/:id", async (req, res) => {
  res.json({ data: await getTransaction(currentUser(res).id, String(req.params.id)) });
});
transactionsRouter.patch(
  "/transactions/:id",
  validate(updateTransactionSchema),
  async (req, res) => {
    res.json({
      data: await updateTransaction(currentUser(res), String(req.params.id), res.locals.body),
    });
  },
);
transactionsRouter.delete("/transactions/:id", async (req, res) => {
  await deleteTransaction(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});
