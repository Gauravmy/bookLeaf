import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import type { DB } from "../db/connection.js";
import type { AppConfig } from "../config.js";
import { getDummyHash, verifyPassword } from "../auth/passwords.js";
import { SESSION_COOKIE, createSession, deleteSession, toPublicUser } from "../auth/sessions.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { HttpError } from "../lib/errors.js";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export function authRoutes(db: DB, config: AppConfig) {
  const router = Router();

  // Per account+IP to slow password guessing, plus a coarser per-IP cap.
  const perAccountLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").toLowerCase()}`,
    handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many login attempts. Please wait 15 minutes and try again.")),
  });
  const perIpLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many requests. Please try again later.")),
  });

  router.post("/login", perIpLimiter, perAccountLimiter, async (req, res) => {
    const { email, password } = LoginSchema.parse(req.body);
    const row = db.prepare("SELECT id, email, name, role, author_id, password_hash FROM users WHERE email = ?").get(email) as
      | { id: number; email: string; name: string; role: "author" | "admin"; author_id: string | null; password_hash: string }
      | undefined;
    // Always run a hash comparison so unknown emails are not faster to reject.
    const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
    if (!row || !ok) throw new HttpError(401, "invalid_credentials", "Incorrect email or password");

    const { token, expiresAt } = createSession(db, row.id, config.sessionTtlHours);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    res.json({ user: toPublicUser(row) });
  });

  router.post("/logout", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string") deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  router.get("/me", requireAuth(), (req, res) => {
    res.json({ user: currentUser(req) });
  });

  return router;
}
