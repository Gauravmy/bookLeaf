import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "../../shared/domain.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import type { AdminTicketService } from "../services/adminTickets.js";
import type { DraftService } from "../services/drafts.js";
import type { TriageRunner } from "../services/triage.js";
import { HttpError } from "../lib/errors.js";
import { idParam } from "./params.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const QueueQuerySchema = z.object({
  // Accepts ?status=Open,In Progress or repeated ?status= params.
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(",")).filter(Boolean)))
    .pipe(z.array(z.enum(TICKET_STATUSES)).optional()),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignee: z.enum(["me", "unassigned"]).optional(),
  overdue: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  createdFrom: isoDate.optional(),
  createdTo: isoDate.optional(),
  sort: z.enum(["urgency", "newest", "oldest", "updated"]).default("urgency"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// .strict() rejects unknown keys, so clients cannot mass-assign fields such as
// author_id or created_at.
const PatchSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Provide at least one field to update");

const ReplySchema = z
  .object({
    body: z.string().trim().min(1, "Reply cannot be empty").max(10_000),
    status: z.enum(TICKET_STATUSES).optional(),
  })
  .strict();
const NoteSchema = z.object({ body: z.string().trim().min(1, "Note cannot be empty").max(5000) }).strict();
const DraftRequestSchema = z.object({ force: z.boolean().default(false) }).strict();

export function adminRoutes(service: AdminTicketService, drafts: DraftService, triage: TriageRunner) {
  const router = Router();
  router.use(requireAuth("admin"));

  // AI endpoints cost money per call; cap them per admin.
  const aiLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `admin:${req.user?.id ?? "anon"}`,
    handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many AI requests. Please wait a few minutes.")),
  });

  router.get("/stats", (_req, res) => {
    res.json(service.stats());
  });

  router.get("/admins", (_req, res) => {
    res.json({ admins: service.listAdmins() });
  });

  router.get("/tickets", (req, res) => {
    res.json(service.list(currentUser(req), QueueQuerySchema.parse(req.query)));
  });

  router.get("/tickets/:id", (req, res) => {
    res.json({ ticket: service.get(idParam(req.params.id)) });
  });

  router.patch("/tickets/:id", (req, res) => {
    const id = idParam(req.params.id);
    service.update(currentUser(req), id, PatchSchema.parse(req.body));
    res.json({ ticket: service.get(id) });
  });

  router.post("/tickets/:id/messages", (req, res) => {
    const id = idParam(req.params.id);
    const { body, status } = ReplySchema.parse(req.body);
    service.reply(currentUser(req), id, body, status);
    res.status(201).json({ ticket: service.get(id) });
  });

  router.post("/tickets/:id/notes", (req, res) => {
    const id = idParam(req.params.id);
    service.addNote(currentUser(req), id, NoteSchema.parse(req.body).body);
    res.status(201).json({ ticket: service.get(id) });
  });

  /** Cached draft only - never triggers a model call. */
  router.get("/tickets/:id/draft", (req, res) => {
    res.json({ draft: drafts.getCached(idParam(req.params.id)) });
  });

  /** Generates a draft, or returns the current cached one unless force=true. */
  router.post("/tickets/:id/draft", aiLimiter, async (req, res) => {
    const { force } = DraftRequestSchema.parse(req.body ?? {});
    res.json({ draft: await drafts.getOrGenerate(idParam(req.params.id), force) });
  });

  /** Re-runs automatic classification + priority (e.g. after an AI outage). Admin overrides are kept. */
  router.post("/tickets/:id/triage", aiLimiter, async (req, res) => {
    const id = idParam(req.params.id);
    service.get(id); // 404 for unknown tickets before spending a model call
    await triage.schedule(id, { force: true });
    res.json({ ticket: service.get(id) });
  });

  return router;
}
