import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import { createBudgetSchema, updateBudgetSchema } from "./schemas.js";
import {
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  previewBudget,
  updateBudget,
} from "./service.js";

export const budgetsRouter = Router();

budgetsRouter.get("/budgets", async (_req, res) => {
  res.json({ data: await listBudgets(currentUser(res)) });
});

budgetsRouter.post("/budgets", validate(createBudgetSchema), async (_req, res) => {
  res.status(201).json(await createBudget(currentUser(res).id, res.locals.body));
});

// Read-only: planned totals of an unsaved Guided draft (spec 003 FR-005)
budgetsRouter.post("/budget-previews", validate(createBudgetSchema), async (_req, res) => {
  res.json({ data: await previewBudget(currentUser(res).id, res.locals.body) });
});

budgetsRouter.get("/budgets/:id", async (req, res) => {
  res.json({ data: await getBudget(currentUser(res), String(req.params.id)) });
});

budgetsRouter.patch("/budgets/:id", validate(updateBudgetSchema), async (req, res) => {
  res.json({
    data: await updateBudget(currentUser(res).id, String(req.params.id), res.locals.body),
  });
});

budgetsRouter.delete("/budgets/:id", async (req, res) => {
  await deleteBudget(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});
