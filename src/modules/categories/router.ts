import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import { createCategorySchema, updateCategorySchema } from "./schemas.js";
import { createCategory, deleteCategory, updateCategory } from "./service.js";

export const categoriesRouter = Router();

categoriesRouter.post(
  "/budgets/:budgetId/categories",
  validate(createCategorySchema),
  async (req, res) => {
    res
      .status(201)
      .json({
        data: await createCategory(
          currentUser(res).id,
          String(req.params.budgetId),
          res.locals.body,
        ),
      });
  },
);

categoriesRouter.patch("/categories/:id", validate(updateCategorySchema), async (req, res) => {
  res.json({
    data: await updateCategory(currentUser(res).id, String(req.params.id), res.locals.body),
  });
});

categoriesRouter.delete("/categories/:id", async (req, res) => {
  await deleteCategory(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});
