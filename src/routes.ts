import { Router } from "express";
import { accountsRouter } from "./modules/accounts/router.js";
import { budgetsRouter } from "./modules/budgets/router.js";
import { categoriesRouter } from "./modules/categories/router.js";
import { itemsRouter } from "./modules/items/router.js";
import { payorsRouter } from "./modules/payors/router.js";
import { profileRouter } from "./modules/profile/router.js";
import { vendorsRouter } from "./modules/vendors/router.js";

export const v1Router = Router();
v1Router.use(profileRouter);
v1Router.use(budgetsRouter);
v1Router.use(categoriesRouter);
v1Router.use(itemsRouter);
v1Router.use(accountsRouter);
v1Router.use(payorsRouter);
v1Router.use(vendorsRouter);
