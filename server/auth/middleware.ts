import type { Request, RequestHandler } from "express";
import type { DB } from "../db/connection.js";
import type { PublicUser, Role } from "../../shared/domain.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { SESSION_COOKIE, findSessionUser } from "./sessions.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: PublicUser;
  }
}

/** Attaches req.user when a valid session cookie is present. Never rejects on its own. */
export function loadUser(db: DB): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0) {
      req.user = findSessionUser(db, token) ?? undefined;
    }
    next();
  };
}

export function requireAuth(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (roles.length > 0 && !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** For handlers mounted behind requireAuth(); narrows the type. */
export function currentUser(req: Request): PublicUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * Defence in depth against CSRF: the session cookie is SameSite=Lax, and in
 * addition any state-changing request that carries an Origin header must come
 * from an allowed origin.
 */
export function checkOrigin(allowedOrigins: string[]): RequestHandler {
  const safe = new Set(["GET", "HEAD", "OPTIONS"]);
  return (req, _res, next) => {
    if (safe.has(req.method)) return next();
    const origin = req.get("origin");
    if (!origin) return next();
    const selfOrigin = `${req.protocol}://${req.get("host")}`;
    if (origin === selfOrigin || allowedOrigins.includes(origin)) return next();
    next(forbidden("Cross-origin request rejected"));
  };
}
