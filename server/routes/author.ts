import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/connection.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { listBooksForAuthor, findAuthor } from "../services/books.js";
import type { AuthorTicketService } from "../services/tickets.js";
import type { TriageRunner } from "../services/triage.js";
import { detectAllowedMime, safeFilename, singleAttachment } from "../lib/uploads.js";
import { notFound } from "../lib/errors.js";
import { idParam } from "./params.js";
import { summariseRoyalties } from "../ai/accountFacts.js";

const NewTicketSchema = z.object({
  // "" or missing means General / Account Level.
  bookId: z
    .string()
    .trim()
    .regex(/^BK\d{3,}$/, "Invalid book ID")
    .or(z.literal(""))
    .nullish()
    .transform((v) => v || null),
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(150),
  description: z.string().trim().min(20, "Please describe the issue in at least 20 characters").max(5000),
});

const MessageSchema = z.object({ body: z.string().trim().min(1, "Message cannot be empty").max(5000) });

/** Endpoints for the signed-in author. Every query is scoped to req.user.authorId. */
export function authorRoutes(db: DB, tickets: AuthorTicketService, triage: TriageRunner) {
  const router = Router();
  router.use(requireAuth("author"));

  router.get("/profile", (req, res) => {
    const user = currentUser(req);
    const author = findAuthor(db, user.authorId!);
    if (!author) throw notFound("Author");
    res.json({ author });
  });

  router.get("/books", (req, res) => {
    res.json({ books: listBooksForAuthor(db, currentUser(req).authorId!) });
  });

  /** Dashboard numbers derived from the author's own records. */
  router.get("/summary", (req, res) => {
    const user = currentUser(req);
    const books = listBooksForAuthor(db, user.authorId!);
    const ticketCounts = db
      .prepare(
        `SELECT SUM(status IN ('Open','In Progress')) AS active, SUM(status IN ('Resolved','Closed')) AS done, COUNT(*) AS total
           FROM tickets WHERE author_id = ?`,
      )
      .get(user.authorId) as { active: number | null; done: number | null; total: number };
    const royalties = summariseRoyalties(books);
    res.json({
      books: {
        total: books.length,
        live: books.filter((b) => b.status === "Published & Live").length,
        inProduction: books.filter((b) => b.status.startsWith("In Production")).length,
      },
      copiesSold: books.reduce((s, b) => s + b.totalCopiesSold, 0),
      royaltyEarned: books.reduce((s, b) => s + b.totalRoyaltyEarned, 0),
      royaltyPaid: books.reduce((s, b) => s + b.royaltyPaid, 0),
      royaltyPending: royalties.totalPending,
      tickets: { active: ticketCounts.active ?? 0, resolved: ticketCounts.done ?? 0, total: ticketCounts.total },
    });
  });

  router.get("/tickets", (req, res) => {
    res.json({ tickets: tickets.list(currentUser(req)) });
  });

  // Accepts JSON or multipart/form-data (when an attachment is included).
  router.post("/tickets", singleAttachment, (req, res) => {
    const user = currentUser(req);
    const input = NewTicketSchema.parse(req.body);
    const attachment = req.file
      ? { filename: safeFilename(req.file.originalname), mimeType: detectAllowedMime(req.file.buffer), data: req.file.buffer }
      : undefined;
    const id = tickets.create(user, input, attachment);
    // Triage runs after the response; AI problems never block ticket creation.
    void triage.schedule(id);
    res.status(201).json({ ticket: tickets.get(user, id) });
  });

  router.get("/tickets/:id", (req, res) => {
    res.json({ ticket: tickets.get(currentUser(req), idParam(req.params.id)) });
  });

  router.post("/tickets/:id/messages", (req, res) => {
    const user = currentUser(req);
    const id = idParam(req.params.id);
    const { body } = MessageSchema.parse(req.body);
    tickets.addMessage(user, id, body);
    res.status(201).json({ ticket: tickets.get(user, id) });
  });

  return router;
}
