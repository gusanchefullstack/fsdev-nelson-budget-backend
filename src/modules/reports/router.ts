import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import { byEntitySchema, rangeSchema, topSchema } from "./schemas.js";
import { byEntityReport, executionReport, suggestionsReport, topReport } from "./service.js";

export const reportsRouter = Router();

reportsRouter.get(
  "/reports/budgets/:id/execution",
  validate(rangeSchema, "query"),
  async (req, res) => {
    res.json({
      data: await executionReport(currentUser(res), String(req.params.id), res.locals.query),
    });
  },
);
reportsRouter.get("/reports/by-entity", validate(byEntitySchema, "query"), async (_req, res) => {
  res.json({ data: await byEntityReport(currentUser(res).id, res.locals.query) });
});
reportsRouter.get("/reports/budgets/:id/top", validate(topSchema, "query"), async (req, res) => {
  res.json({ data: await topReport(currentUser(res), String(req.params.id), res.locals.query) });
});
reportsRouter.get("/reports/budgets/:id/suggestions", async (req, res) => {
  res.json({ data: await suggestionsReport(currentUser(res), String(req.params.id)) });
});
