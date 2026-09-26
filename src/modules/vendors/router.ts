import { counterpartyRouter } from "../counterparties/router-factory.js";

export const vendorsRouter = counterpartyRouter({
  model: "vendor",
  path: "vendors",
  noun: "vendor",
  types: ["UTILITY", "SUBSCRIPTION", "STORE", "SERVICE", "OTHER"],
});
