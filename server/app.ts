import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "node:path";
import { existsSync } from "node:fs";
import type { AppConfig } from "./config.js";
import type { DB } from "./db/connection.js";
import { DisabledProvider, type LlmProvider } from "./ai/provider.js";
import { checkOrigin, currentUser, loadUser, requireAuth } from "./auth/middleware.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { TicketEventBus } from "./realtime/bus.js";
import { AuthorTicketService, getAttachmentForUser } from "./services/tickets.js";
import { AdminTicketService } from "./services/adminTickets.js";
import { TriageRunner } from "./services/triage.js";
import { DraftService } from "./services/drafts.js";
import { authRoutes } from "./routes/auth.js";
import { authorRoutes } from "./routes/author.js";
import { adminRoutes } from "./routes/admin.js";
import { idParam } from "./routes/params.js";

export interface AppDeps {
  config: AppConfig;
  db: DB;
  provider: LlmProvider;
  /** Injectable clock for deterministic royalty-schedule tests. */
  clock?: () => Date;
  /** Directory with the built SPA; served in production. */
  webDir?: string;
}

export function createApp({ config, db, provider, clock, webDir }: AppDeps) {
  const bus = new TicketEventBus();
  const authorTickets = new AuthorTicketService(db, bus);
  const adminTickets = new AdminTicketService(db, bus);
  const triage = new TriageRunner(db, provider, bus);
  const drafts = new DraftService(db, provider, clock);

  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", checkOrigin(config.allowedOrigins));
  app.use("/api", loadUser(db));
  // API responses contain personal data; keep them out of shared caches.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ai: { configured: !(provider instanceof DisabledProvider), model: provider.model } });
  });

  app.use("/api/auth", authRoutes(db, config));
  app.use("/api/author", authorRoutes(db, authorTickets, triage));
  app.use("/api/admin", adminRoutes(adminTickets, drafts, triage));

  app.get("/api/attachments/:id", requireAuth(), (req, res) => {
    const file = getAttachmentForUser(db, currentUser(req), idParam(req.params.id));
    // Force download and forbid MIME sniffing so an upload can never render as HTML.
    res.set({
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    });
    res.send(file.data);
  });

  app.get("/api/events", requireAuth(), (req, res) => {
    bus.subscribe(req, res, currentUser(req));
  });

  app.use("/api", notFoundHandler);

  if (webDir && existsSync(webDir)) {
    app.use(express.static(webDir, { index: false, maxAge: "1h" }));
    // SPA fallback: client-side routes all serve index.html.
    app.get("/{*path}", (_req, res) => res.sendFile(path.resolve(webDir, "index.html")));
  }

  app.use(errorHandler);
  return { app, bus, triage, drafts };
}
