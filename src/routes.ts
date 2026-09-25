import { Router } from "express";
import { profileRouter } from "./modules/profile/router.js";

export const v1Router = Router();
v1Router.use(profileRouter);
