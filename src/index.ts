import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { requireSession } from "./lib/session.js";
import { v1Router } from "./routes.js";

const app = express();
app.set("trust proxy", true);

// Better Auth reads the raw body, so it is mounted before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/v1", requireSession, v1Router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
