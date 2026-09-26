import { counterpartyRouter } from "../counterparties/router-factory.js";

export const payorsRouter = counterpartyRouter({
  model: "payor",
  path: "payors",
  noun: "payor",
  types: ["EMPLOYER", "INVESTMENT", "RENTAL", "OTHER"],
});
