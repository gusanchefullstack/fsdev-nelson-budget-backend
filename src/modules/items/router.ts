import { Router } from "express";
import { currentUser } from "../../lib/session.js";
import { validate } from "../../lib/validate.js";
import { createItemSchema, updateItemSchema } from "./schemas.js";
import { createItem, deleteItem, getItem, updateItem } from "./service.js";

export const itemsRouter = Router();

itemsRouter.post("/categories/:categoryId/items", validate(createItemSchema), async (req, res) => {
  res
    .status(201)
    .json(await createItem(currentUser(res), String(req.params.categoryId), res.locals.body));
});

itemsRouter.get("/items/:id", async (req, res) => {
  res.json({ data: await getItem(currentUser(res), String(req.params.id)) });
});

itemsRouter.patch("/items/:id", validate(updateItemSchema), async (req, res) => {
  res.json(await updateItem(currentUser(res), String(req.params.id), res.locals.body));
});

itemsRouter.delete("/items/:id", async (req, res) => {
  await deleteItem(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});
