import type { DB } from "../db/connection.js";
import { nowIso } from "../db/connection.js";
import {
  RESPONSE_TARGET_HOURS,
  TICKET_PRIORITIES,
  type AdminTicketDetail,
  type AdminTicketSummary,
  type Paginated,
  type PublicUser,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type TriageSource,
} from "../../shared/domain.js";
import { badRequest, notFound } from "../lib/errors.js";
import type { TicketEventBus } from "../realtime/bus.js";
import { findAuthor, findBook } from "./books.js";
import { getTicketRow, loadAttachments, loadMessages, recordEvent, type TicketRow } from "./tickets.js";

export type QueueSort = "urgency" | "newest" | "oldest" | "updated";

export interface QueueFilters {
  status?: TicketStatus[];
  category?: TicketCategory;
  priority?: TicketPriority;
  assignee?: "me" | "unassigned";
  overdue?: boolean;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
  sort: QueueSort;
  page: number;
  pageSize: number;
}

export interface TicketPatch {
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assigneeId?: number | null;
}

// Hours a ticket may wait for a BookLeaf reply before it is flagged overdue.
// Untriaged tickets use the Medium target.
const TARGET_HOURS_SQL = `CASE t.priority ${TICKET_PRIORITIES.map((p) => `WHEN '${p}' THEN ${RESPONSE_TARGET_HOURS[p]}`).join(" ")} ELSE ${RESPONSE_TARGET_HOURS.Medium} END`;
const OVERDUE_SQL = `(t.status IN ('Open', 'In Progress') AND t.awaiting_since IS NOT NULL
  AND (julianday(?) - julianday(t.awaiting_since)) * 24 > ${TARGET_HOURS_SQL})`;
const PRIORITY_RANK_SQL = `CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 2 END`;

// Whitelisted ORDER BY clauses; user input never reaches SQL text.
const SORT_SQL: Record<QueueSort, string> = {
  // Unresolved first, then overdue, then priority, then oldest waiting.
  urgency: `CASE WHEN t.status IN ('Open', 'In Progress') THEN 0 ELSE 1 END, overdue DESC, ${PRIORITY_RANK_SQL}, COALESCE(t.awaiting_since, t.created_at) ASC`,
  newest: "t.created_at DESC",
  oldest: "t.created_at ASC",
  updated: "t.updated_at DESC",
};

type SummaryRow = TicketRow & {
  author_name: string;
  book_title: string | null;
  assignee_name: string | null;
  overdue: number;
  message_count: number;
};

const SUMMARY_SELECT = `
  SELECT t.*, a.name AS author_name, b.title AS book_title, u.name AS assignee_name,
         ${OVERDUE_SQL} AS overdue,
         (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM tickets t
    JOIN authors a ON a.id = t.author_id
    LEFT JOIN books b ON b.id = t.book_id
    LEFT JOIN users u ON u.id = t.assignee_id`;

function toSummary(r: SummaryRow): AdminTicketSummary {
  return {
    id: r.id,
    subject: r.subject,
    status: r.status,
    category: r.category,
    categorySource: r.category_source as TriageSource,
    priority: r.priority,
    prioritySource: r.priority_source as TriageSource,
    authorId: r.author_id,
    authorName: r.author_name,
    bookId: r.book_id,
    bookTitle: r.book_title,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    firstResponseAt: r.first_response_at,
    overdue: r.overdue === 1,
    messageCount: r.message_count,
  };
}

export class AdminTicketService {
  constructor(
    private readonly db: DB,
    private readonly bus: TicketEventBus,
  ) {}

  list(admin: PublicUser, f: QueueFilters): Paginated<AdminTicketSummary> {
    const now = nowIso();
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.status?.length) {
      where.push(`t.status IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(f.status));
    }
    if (f.category) {
      where.push("t.category = ?");
      params.push(f.category);
    }
    if (f.priority) {
      where.push("t.priority = ?");
      params.push(f.priority);
    }
    if (f.assignee === "me") {
      where.push("t.assignee_id = ?");
      params.push(admin.id);
    } else if (f.assignee === "unassigned") {
      where.push("t.assignee_id IS NULL");
    }
    if (f.overdue) {
      where.push(OVERDUE_SQL);
      params.push(now);
    }
    if (f.createdFrom) {
      where.push("t.created_at >= ?");
      params.push(f.createdFrom);
    }
    if (f.createdTo) {
      // Inclusive end date: compare against the start of the following day.
      where.push("t.created_at < date(?, '+1 day')");
      params.push(f.createdTo);
    }
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        `(t.subject LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\'
          OR b.title LIKE ? ESCAPE '\\' OR t.author_id = ? OR CAST(t.id AS TEXT) = ?)`,
      );
      params.push(like, like, like, like, f.q.toUpperCase(), f.q.replace(/^#/, ""));
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM tickets t JOIN authors a ON a.id = t.author_id LEFT JOIN books b ON b.id = t.book_id ${whereSql}`)
        .get(...params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(`${SUMMARY_SELECT} ${whereSql} ORDER BY ${SORT_SQL[f.sort]}, t.id DESC LIMIT ? OFFSET ?`)
      .all(now, ...params, f.pageSize, (f.page - 1) * f.pageSize) as SummaryRow[];
    return { items: rows.map(toSummary), page: f.page, pageSize: f.pageSize, total };
  }

  get(ticketId: number): AdminTicketDetail {
    const row = this.db.prepare(`${SUMMARY_SELECT} WHERE t.id = ?`).get(nowIso(), ticketId) as SummaryRow | undefined;
    if (!row) throw notFound("Ticket");
    const author = findAuthor(this.db, row.author_id);
    if (!author) throw notFound("Author");
    const notes = this.db
      .prepare(
        `SELECT n.id, u.name AS author_name, n.body, n.created_at FROM internal_notes n
           JOIN users u ON u.id = n.admin_id WHERE n.ticket_id = ? ORDER BY n.created_at, n.id`,
      )
      .all(ticketId) as { id: number; author_name: string; body: string; created_at: string }[];
    const events = this.db
      .prepare(
        `SELECT e.id, u.name AS actor_name, e.type, e.detail, e.created_at FROM ticket_events e
           LEFT JOIN users u ON u.id = e.actor_id WHERE e.ticket_id = ? ORDER BY e.created_at, e.id`,
      )
      .all(ticketId) as { id: number; actor_name: string | null; type: string; detail: string; created_at: string }[];
    return {
      ...toSummary(row),
      description: row.description,
      triageRationale: row.triage_rationale,
      triageError: row.triage_error,
      messages: loadMessages(this.db, [ticketId]).get(ticketId) ?? [],
      attachments: loadAttachments(this.db, [ticketId]).get(ticketId) ?? [],
      notes: notes.map((n) => ({ id: n.id, authorName: n.author_name, body: n.body, createdAt: n.created_at })),
      events: events.map((e) => ({ id: e.id, actorName: e.actor_name, type: e.type, detail: e.detail, createdAt: e.created_at })),
      book: row.book_id ? findBook(this.db, row.book_id) : null,
      author,
    };
  }

  /** Applies admin edits. Category/priority edits become "admin" overrides that automatic triage never overwrites. */
  update(admin: PublicUser, ticketId: number, patch: TicketPatch) {
    const row = getTicketRow(this.db, ticketId);
    if (!row) throw notFound("Ticket");
    if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
      const assignee = this.db.prepare("SELECT role FROM users WHERE id = ?").get(patch.assigneeId) as { role: string } | undefined;
      if (assignee?.role !== "admin") throw badRequest("Tickets can only be assigned to admin users");
    }
    const now = nowIso();
    this.db.transaction(() => {
      const sets: string[] = ["updated_at = @now"];
      const values: Record<string, unknown> = { now, id: ticketId };
      if (patch.status && patch.status !== row.status) {
        sets.push("status = @status");
        values.status = patch.status;
        sets.push(patch.status === "Resolved" || patch.status === "Closed" ? "resolved_at = COALESCE(resolved_at, @now)" : "resolved_at = NULL");
        recordEvent(this.db, ticketId, admin.id, "status", `Status changed from ${row.status} to ${patch.status}`);
      }
      if (patch.category && (patch.category !== row.category || row.category_source !== "admin")) {
        sets.push("category = @category", "category_source = 'admin'");
        values.category = patch.category;
        recordEvent(this.db, ticketId, admin.id, "category", `Category set to ${patch.category} (was ${row.category ?? "unclassified"}, ${row.category_source})`);
      }
      if (patch.priority && (patch.priority !== row.priority || row.priority_source !== "admin")) {
        sets.push("priority = @priority", "priority_source = 'admin'");
        values.priority = patch.priority;
        recordEvent(this.db, ticketId, admin.id, "priority", `Priority set to ${patch.priority} (was ${row.priority ?? "unset"}, ${row.priority_source})`);
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== row.assignee_id) {
        sets.push("assignee_id = @assigneeId");
        values.assigneeId = patch.assigneeId;
        const name = patch.assigneeId === null ? null : (this.db.prepare("SELECT name FROM users WHERE id = ?").get(patch.assigneeId) as { name: string }).name;
        recordEvent(this.db, ticketId, admin.id, "assignment", name ? `Assigned to ${name}` : "Unassigned");
      }
      this.db.prepare(`UPDATE tickets SET ${sets.join(", ")} WHERE id = @id`).run(values);
    })();
    this.bus.publish({ ticketId, authorId: row.author_id, kind: "updated" });
  }

  /** Sends an author-visible reply. Only ever called from an explicit admin action. */
  reply(admin: PublicUser, ticketId: number, body: string, statusAfter?: TicketStatus) {
    const row = getTicketRow(this.db, ticketId);
    if (!row) throw notFound("Ticket");
    const now = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, created_at) VALUES (?, ?, 'admin', ?, ?)")
        .run(ticketId, admin.id, body, now);
      this.db
        .prepare("UPDATE tickets SET updated_at = ?, awaiting_since = NULL, first_response_at = COALESCE(first_response_at, ?) WHERE id = ?")
        .run(now, now, ticketId);
      recordEvent(this.db, ticketId, admin.id, "reply", "Reply sent to author");
    })();
    if (statusAfter && statusAfter !== row.status) this.update(admin, ticketId, { status: statusAfter });
    this.bus.publish({ ticketId, authorId: row.author_id, kind: "message" });
  }

  addNote(admin: PublicUser, ticketId: number, body: string) {
    const row = getTicketRow(this.db, ticketId);
    if (!row) throw notFound("Ticket");
    this.db
      .prepare("INSERT INTO internal_notes (ticket_id, admin_id, body, created_at) VALUES (?, ?, ?, ?)")
      .run(ticketId, admin.id, body, nowIso());
    // Notes do not touch updated_at or notify the author: authors must not even
    // learn that a note exists.
  }

  listAdmins() {
    return this.db.prepare("SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY name").all() as {
      id: number;
      name: string;
      email: string;
    }[];
  }

  /** Dashboard metrics computed from real ticket data. */
  stats() {
    const now = nowIso();
    const one = <T>(sql: string, ...p: unknown[]) => this.db.prepare(sql).get(...p) as T;
    const counts = one<{ open: number; in_progress: number; resolved: number; closed: number; unassigned: number; urgent: number }>(
      `SELECT
         SUM(status = 'Open') AS open, SUM(status = 'In Progress') AS in_progress,
         SUM(status = 'Resolved') AS resolved, SUM(status = 'Closed') AS closed,
         SUM(status IN ('Open','In Progress') AND assignee_id IS NULL) AS unassigned,
         SUM(status IN ('Open','In Progress') AND priority IN ('Critical','High')) AS urgent
       FROM tickets`,
    );
    const overdue = one<{ n: number }>(`SELECT COUNT(*) AS n FROM tickets t WHERE ${OVERDUE_SQL}`, now).n;
    const byCategory = this.db
      .prepare(
        `SELECT COALESCE(category, 'Unclassified') AS category, COUNT(*) AS count FROM tickets
          WHERE status IN ('Open','In Progress') GROUP BY 1 ORDER BY count DESC`,
      )
      .all() as { category: string; count: number }[];
    const firstResponse = one<{ avg_hours: number | null; n: number }>(
      `SELECT AVG((julianday(first_response_at) - julianday(created_at)) * 24) AS avg_hours, COUNT(*) AS n
         FROM tickets WHERE first_response_at IS NOT NULL`,
    );
    return {
      open: counts.open ?? 0,
      inProgress: counts.in_progress ?? 0,
      resolved: counts.resolved ?? 0,
      closed: counts.closed ?? 0,
      unassigned: counts.unassigned ?? 0,
      urgent: counts.urgent ?? 0,
      overdue,
      byCategory,
      avgFirstResponseHours: firstResponse.avg_hours === null ? null : Math.round(firstResponse.avg_hours * 10) / 10,
      respondedTickets: firstResponse.n,
    };
  }
}
