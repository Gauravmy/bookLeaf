import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") =>
  new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new HttpError(403, "forbidden", message);
// Used for records that exist but belong to someone else too, so authors cannot
// probe which ticket IDs exist.
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err?.name === "MulterError") {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({
      error: { code: tooLarge ? "file_too_large" : "invalid_upload", message: tooLarge ? "Attachment must be 5 MB or smaller" : err.message },
    });
    return;
  }
  // Body-parser errors (malformed JSON, payload too large) carry a status.
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: { code: err.type ?? "bad_request", message: err.message } });
    return;
  }
  // Log the full error server-side only; never leak stack traces to clients.
  console.error("[error]", err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong on our side" } });
};
