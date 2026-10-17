import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type AdminTicketDetail,
  type TicketStatus,
} from "../../../../shared/domain";
import { errorMessage } from "../../api/client";
import { useAddNote, useAdminTicket, useAdmins, useHealth, useRerunTriage, useUpdateTicket, type TicketPatch } from "../../api/queries";
import { useAuth } from "../../lib/auth";
import { ConfirmDialog, ErrorState, LoadingBlock, Notice, PriorityBadge, SourceTag, Spinner, StatusBadge } from "../../components/ui";
import { TicketThread } from "../../components/TicketThread";
import { formatDate, formatDateTime, formatINR, formatNumber, timeAgo } from "../../lib/format";
import { ReplyComposer } from "./ReplyComposer";

export function AdminTicketPage() {
  const id = Number(useParams().id);
  const ticket = useAdminTicket(id);
  if (ticket.isPending) return <LoadingBlock />;
  if (ticket.isError) return <ErrorState error={ticket.error} onRetry={() => ticket.refetch()} />;
  const t = ticket.data;

  return (
    <div className="page page-wide">
      <p className="breadcrumb">
        <Link to="/admin">← Ticket Queue</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{t.subject}</h1>
          <div className="meta">
            <span className="ticket-id">#{t.id}</span>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            {t.overdue && <span className="badge overdue">Overdue</span>}
            <span>
              {t.author.name} ({t.author.id})
            </span>
            <span>{t.book ? t.book.title : "General / Account Level"}</span>
            <span title={formatDateTime(t.createdAt)}>Opened {timeAgo(t.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <h2 className="card-title">Conversation</h2>
            <TicketThread authorName={t.author.name} description={t.description} createdAt={t.createdAt} messages={t.messages} attachments={t.attachments} viewer="admin" />
          </section>
          <ReplyComposer key={t.id} ticket={t} />
        </div>
        <aside className="detail-side">
          <ManagePanel ticket={t} />
          <ContextPanel ticket={t} />
          <NotesPanel ticket={t} />
          <ActivityPanel ticket={t} />
        </aside>
      </div>
    </div>
  );
}

function ManagePanel({ ticket }: { ticket: AdminTicketDetail }) {
  const { user } = useAuth();
  const admins = useAdmins();
  const update = useUpdateTicket(ticket.id);
  const rerun = useRerunTriage(ticket.id);
  const aiConfigured = useHealth().data?.ai.configured ?? false;
  const [pendingClose, setPendingClose] = useState(false);

  const apply = (patch: TicketPatch) => update.mutate(patch);
  const onStatus = (status: TicketStatus) => (status === "Closed" ? setPendingClose(true) : apply({ status }));

  return (
    <section className="card" aria-labelledby="manage-title">
      <h2 className="card-title" id="manage-title">
        Manage {update.isPending && <Spinner label="Saving" />}
      </h2>
      {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
      <div className="field">
        <label htmlFor="m-status">Status</label>
        <select id="m-status" value={ticket.status} onChange={(e) => onStatus(e.target.value as TicketStatus)} disabled={update.isPending}>
          {TICKET_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="m-assignee">Assignee</label>
        <div className="row">
          <select
            id="m-assignee"
            value={ticket.assigneeId ?? ""}
            onChange={(e) => apply({ assigneeId: e.target.value ? Number(e.target.value) : null })}
            disabled={update.isPending || admins.isPending}
          >
            <option value="">Unassigned</option>
            {admins.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {user && ticket.assigneeId !== user.id && (
            <button className="btn btn-secondary btn-sm" onClick={() => apply({ assigneeId: user.id })} disabled={update.isPending}>
              Assign to me
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="m-category">
          Category {ticket.category && <SourceTag source={ticket.categorySource} />}
        </label>
        <select
          id="m-category"
          value={ticket.category ?? ""}
          onChange={(e) => e.target.value && apply({ category: e.target.value as (typeof TICKET_CATEGORIES)[number] })}
          disabled={update.isPending}
        >
          {!ticket.category && <option value="">Triaging…</option>}
          {TICKET_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="m-priority">
          Priority {ticket.priority && <SourceTag source={ticket.prioritySource} />}
        </label>
        <select
          id="m-priority"
          value={ticket.priority ?? ""}
          onChange={(e) => e.target.value && apply({ priority: e.target.value as (typeof TICKET_PRIORITIES)[number] })}
          disabled={update.isPending}
        >
          {!ticket.priority && <option value="">Triaging…</option>}
          {TICKET_PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      {ticket.triageRationale && (
        <details className="rationale">
          <summary>Why this triage?</summary>
          <p className="small">{ticket.triageRationale}</p>
        </details>
      )}
      {ticket.triageError && (
        <Notice tone="warning">
          <span className="small">AI triage unavailable ({ticket.triageError}). Rule-based values are shown - please review.</span>
        </Notice>
      )}
      {rerun.isError && <Notice tone="error">{errorMessage(rerun.error)}</Notice>}
      {aiConfigured && (ticket.categorySource === "rules" || ticket.prioritySource === "rules") && (
        <button className="btn btn-ghost btn-sm" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
          {rerun.isPending && <Spinner label="Re-running" />}
          Re-run AI triage
        </button>
      )}

      <ConfirmDialog
        open={pendingClose}
        title="Close this ticket?"
        confirmLabel="Close ticket"
        tone="danger"
        busy={update.isPending}
        onConfirm={() => update.mutate({ status: "Closed" }, { onSettled: () => setPendingClose(false) })}
        onCancel={() => setPendingClose(false)}
      >
        <p>The author will no longer be able to reply to a closed ticket; they would need to open a new one.</p>
      </ConfirmDialog>
    </section>
  );
}

function ContextPanel({ ticket }: { ticket: AdminTicketDetail }) {
  const b = ticket.book;
  return (
    <section className="card" aria-labelledby="context-title">
      <h2 className="card-title" id="context-title">
        Author &amp; book
      </h2>
      <dl className="facts facts-compact">
        <div>
          <dt>Author</dt>
          <dd>
            {ticket.author.name} · {ticket.author.id}
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{ticket.author.email}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{formatDate(ticket.author.joinedDate)}</dd>
        </div>
        {b ? (
          <>
            <div>
              <dt>Book</dt>
              <dd>
                {b.title} · {b.id}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{b.status}</dd>
            </div>
            <div>
              <dt>ISBN</dt>
              <dd>{b.isbn ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt>MRP</dt>
              <dd>{b.mrp === null ? "Not set" : formatINR(b.mrp)}</dd>
            </div>
            <div>
              <dt>Copies sold</dt>
              <dd>{formatNumber(b.totalCopiesSold)}</dd>
            </div>
            <div>
              <dt>Royalty earned / paid / pending</dt>
              <dd>
                {formatINR(b.totalRoyaltyEarned)} / {formatINR(b.royaltyPaid)} / {formatINR(b.royaltyPending)}
              </dd>
            </div>
            <div>
              <dt>Last payout</dt>
              <dd>{b.lastRoyaltyPayoutDate ? formatDate(b.lastRoyaltyPayoutDate) : "None recorded"}</dd>
            </div>
            <div>
              <dt>Print partner</dt>
              <dd>{b.printPartner ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt>Available on</dt>
              <dd>{b.availableOn.length ? b.availableOn.join(", ") : "Not listed"}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Book</dt>
            <dd>General / Account Level</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function NotesPanel({ ticket }: { ticket: AdminTicketDetail }) {
  const addNote = useAddNote(ticket.id);
  const [body, setBody] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await addNote.mutateAsync(body.trim());
      setBody("");
    } catch {
      /* shown via addNote.error */
    }
  }

  return (
    <section className="card notes" aria-labelledby="notes-title">
      <h2 className="card-title" id="notes-title">
        Internal notes <span className="muted small">· never visible to authors</span>
      </h2>
      {ticket.notes.length === 0 ? (
        <p className="muted small">No notes yet.</p>
      ) : (
        <ul className="note-list">
          {ticket.notes.map((n) => (
            <li key={n.id}>
              <div className="small muted">
                {n.authorName} · {formatDateTime(n.createdAt)}
              </div>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="form">
        <label htmlFor="note" className="sr-only">
          New internal note
        </label>
        <textarea id="note" rows={3} placeholder="Add a note for the team…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
        {addNote.isError && <Notice tone="error">{errorMessage(addNote.error)}</Notice>}
        <button className="btn btn-secondary btn-sm" type="submit" disabled={!body.trim() || addNote.isPending}>
          Add note
        </button>
      </form>
    </section>
  );
}

function ActivityPanel({ ticket }: { ticket: AdminTicketDetail }) {
  return (
    <section className="card" aria-labelledby="activity-title">
      <details>
        <summary>
          <h2 className="card-title inline" id="activity-title">
            Activity ({ticket.events.length})
          </h2>
        </summary>
        <ol className="activity">
          {ticket.events.map((e) => (
            <li key={e.id}>
              <span className="small muted">{formatDateTime(e.createdAt)}</span>
              <span className="small">
                {e.actorName ?? "System"}: {e.detail}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
