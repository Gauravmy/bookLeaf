import type { DB } from "../db/connection.js";
import { nowIso } from "../db/connection.js";
import type {
  AuthorTicket,
  PublicUser,
  TicketAttachment,
  TicketCategory,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from "../../shared/domain.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { TicketEventBus } from "../realtime/bus.js";
import { findBook } from "./books.js";

export interface TicketRow {
  id: number;
  author_id: string;
  book_id: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  category: TicketCategory | null;
  category_source: string;
  priority: TicketPriority | null;
  priority_source: string;
  triage_rationale: string | null;
  triage_error: string | null;
  assignee_id: number | null;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  awaiting_since: string | null;
  resolved_at: string | null;
}

export interface NewAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export function getTicketRow(db: DB, ticketId: number): TicketRow | undefined {
  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId) as TicketRow | undefined;
}

export function recordEvent(db: DB, ticketId: number, actorId: number | null, type: string, detail: string) {
  db.prepare("INSERT INTO ticket_events (ticket_id, actor_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(
    ticketId,
    actorId,
    type,
    detail,
    nowIso(),
  );
}

export function loadMessages(db: DB, ticketIds: number[]): Map<number, TicketMessage[]> {
  const byTicket = new Map<number, TicketMessage[]>();
  if (ticketIds.length === 0) return byTicket;
  const rows = db
    .prepare(
      `SELECT m.id, m.ticket_id, m.sender_role, u.name AS sender_name, m.body, m.created_at
         FROM ticket_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.ticket_id IN (SELECT value FROM json_each(?))
        ORDER BY m.created_at, m.id`,
    )
    .all(JSON.stringify(ticketIds)) as {
    id: number;
    ticket_id: number;
    sender_role: "author" | "admin";
    sender_name: string;
    body: string;
    created_at: string;
  }[];
  for (const r of rows) {
    const list = byTicket.get(r.ticket_id) ?? [];
    list.push({ id: r.id, senderRole: r.sender_role, senderName: r.sender_name, body: r.body, createdAt: r.created_at });
    byTicket.set(r.ticket_id, list);
  }
  return byTicket;
}

export function loadAttachments(db: DB, ticketIds: number[]): Map<number, TicketAttachment[]> {
  const byTicket = new Map<number, TicketAttachment[]>();
  if (ticketIds.length === 0) return byTicket;
  // Never select the BLOB here; file bytes are only read by the download endpoint.
  const rows = db
    .prepare(
      `SELECT id, ticket_id, filename, mime_type, size_bytes FROM ticket_attachments
        WHERE ticket_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .all(JSON.stringify(ticketIds)) as { id: number; ticket_id: number; filename: string; mime_type: string; size_bytes: number }[];
  for (const r of rows) {
    const list = byTicket.get(r.ticket_id) ?? [];
    list.push({ id: r.id, filename: r.filename, mimeType: r.mime_type, sizeBytes: r.size_bytes });
    byTicket.set(r.ticket_id, list);
  }
  return byTicket;
}

/**
 * Author-side ticket operations. Every query is scoped by the caller's
 * author_id, so ownership is enforced in SQL rather than by the UI.
 */
export class AuthorTicketService {
  constructor(
    private readonly db: DB,
    private readonly bus: TicketEventBus,
  ) {}

  create(
    user: PublicUser,
    input: { bookId: string | null; subject: string; description: string },
    attachment?: NewAttachment,
  ): number {
    const authorId = requireAuthorId(user);
    if (input.bookId) {
      const book = findBook(this.db, input.bookId);
      // Same message whether the book is missing or someone else's.
      if (!book || book.authorId !== authorId) throw badRequest("Selected book was not found in your account");
    }
    const now = nowIso();
    const ticketId = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO tickets (author_id, book_id, subject, description, status, created_at, updated_at, awaiting_since)
           VALUES (?, ?, ?, ?, 'Open', ?, ?, ?)`,
        )
        .run(authorId, input.bookId, input.subject, input.description, now, now, now);
      const id = Number(result.lastInsertRowid);
      if (attachment) {
        this.db
          .prepare(
            "INSERT INTO ticket_attachments (ticket_id, filename, mime_type, size_bytes, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(id, attachment.filename, attachment.mimeType, attachment.data.length, attachment.data, now);
      }
      recordEvent(this.db, id, user.id, "created", "Ticket submitted by author");
      return id;
    })();
    this.bus.publish({ ticketId, authorId, kind: "created" });
    return ticketId;
  }

  list(user: PublicUser): AuthorTicket[] {
    const authorId = requireAuthorId(user);
    const rows = this.db
      .prepare(
        `SELECT t.*, b.title AS book_title FROM tickets t LEFT JOIN books b ON b.id = t.book_id
          WHERE t.author_id = ? ORDER BY t.updated_at DESC, t.id DESC`,
      )
      .all(authorId) as (TicketRow & { book_title: string | null })[];
    const ids = rows.map((r) => r.id);
    const messages = loadMessages(this.db, ids);
    const attachments = loadAttachments(this.db, ids);
    return rows.map((r) => toAuthorTicket(r, messages.get(r.id) ?? [], attachments.get(r.id) ?? []));
  }

  get(user: PublicUser, ticketId: number): AuthorTicket {
    const authorId = requireAuthorId(user);
    const row = this.db
      .prepare(
        `SELECT t.*, b.title AS book_title FROM tickets t LEFT JOIN books b ON b.id = t.book_id
          WHERE t.id = ? AND t.author_id = ?`,
      )
      .get(ticketId, authorId) as (TicketRow & { book_title: string | null }) | undefined;
    if (!row) throw notFound("Ticket");
    return toAuthorTicket(row, loadMessages(this.db, [row.id]).get(row.id) ?? [], loadAttachments(this.db, [row.id]).get(row.id) ?? []);
  }

  /** Author follow-up. Replying to a Resolved ticket reopens it; Closed tickets are final. */
  addMessage(user: PublicUser, ticketId: number, body: string) {
    const authorId = requireAuthorId(user);
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ? AND author_id = ?").get(ticketId, authorId) as
      | TicketRow
      | undefined;
    if (!row) throw notFound("Ticket");
    if (row.status === "Closed") throw conflict("This ticket is closed. Please open a new ticket for further help.");
    const now = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, created_at) VALUES (?, ?, 'author', ?, ?)")
        .run(ticketId, user.id, body, now);
      const reopen = row.status === "Resolved";
      this.db
        .prepare(
          `UPDATE tickets SET updated_at = ?, awaiting_since = COALESCE(awaiting_since, ?),
             status = CASE WHEN status = 'Resolved' THEN 'Open' ELSE status END,
             resolved_at = CASE WHEN status = 'Resolved' THEN NULL ELSE resolved_at END
           WHERE id = ?`,
        )
        .run(now, now, ticketId);
      recordEvent(this.db, ticketId, user.id, "author_message", reopen ? "Author replied; ticket reopened" : "Author replied");
    })();
    this.bus.publish({ ticketId, authorId, kind: "message" });
  }
}

function requireAuthorId(user: PublicUser): string {
  if (!user.authorId) throw badRequest("Only author accounts can use this endpoint");
  return user.authorId;
}

function toAuthorTicket(
  row: TicketRow & { book_title: string | null },
  messages: TicketMessage[],
  attachments: TicketAttachment[],
): AuthorTicket {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    category: row.category,
    priority: row.priority,
    bookId: row.book_id,
    bookTitle: row.book_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    attachments,
  };
}

/** Attachment download with the same ownership rule as tickets (admins may read any). */
export function getAttachmentForUser(db: DB, user: PublicUser, attachmentId: number) {
  const row = db
    .prepare(
      `SELECT a.filename, a.mime_type, a.data, t.author_id FROM ticket_attachments a
         JOIN tickets t ON t.id = a.ticket_id WHERE a.id = ?`,
    )
    .get(attachmentId) as { filename: string; mime_type: string; data: Buffer; author_id: string } | undefined;
  if (!row || (user.role !== "admin" && row.author_id !== user.authorId)) throw notFound("Attachment");
  return { filename: row.filename, mimeType: row.mime_type, data: row.data };
}
