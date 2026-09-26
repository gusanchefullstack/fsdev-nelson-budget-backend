import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { dashboard } from "./service.js";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (_req, res) => {
  res.json({ data: await dashboard(currentUser(res)) });
});
