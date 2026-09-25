import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = "We couldn't find that item.") =>
  new AppError(404, "NOT_FOUND", what);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);

// Zod issues -> { "path.to.field": "message" }
export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

function prismaCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "We couldn't find that page." } });
};

// Every error leaves the API as a friendly envelope; details are only logged (Principle III).
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted fields.",
        fields: zodFields(err),
      },
    });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res
      .status(400)
      .json({ error: { code: "BAD_REQUEST", message: "The request could not be read." } });
    return;
  }
  const code = prismaCode(err);
  if (code === "P2025") {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "We couldn't find that item." } });
    return;
  }
  if (code === "P2002" || String(err?.message ?? "").includes("budget_no_overlap")) {
    res
      .status(409)
      .json({ error: { code: "CONFLICT", message: "This conflicts with existing data." } });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong on our side. Please try again.",
    },
  });
};
