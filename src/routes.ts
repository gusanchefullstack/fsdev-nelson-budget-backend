import { Router } from "express";
import { budgetsRouter } from "./modules/budgets/router.js";
import { categoriesRouter } from "./modules/categories/router.js";
import { itemsRouter } from "./modules/items/router.js";
import { profileRouter } from "./modules/profile/router.js";

export const v1Router = Router();
v1Router.use(profileRouter);
v1Router.use(budgetsRouter);
v1Router.use(categoriesRouter);
v1Router.use(itemsRouter);
