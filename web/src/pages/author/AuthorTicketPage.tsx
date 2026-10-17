import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { useAuthorReply, useMyTicket } from "../../api/queries";
import { ErrorState, LoadingBlock, Notice, PriorityBadge, Spinner, StatusBadge } from "../../components/ui";
import { TicketThread } from "../../components/TicketThread";
import { formatDate } from "../../lib/format";

export function AuthorTicketPage() {
  const id = Number(useParams().id);
  const location = useLocation();
  const ticket = useMyTicket(id);
  const reply = useAuthorReply(id);
  const [body, setBody] = useState("");
  const justCreated = (location.state as { created?: boolean } | null)?.created;

  if (ticket.isPending) return <LoadingBlock />;
  if (ticket.isError) return <ErrorState error={ticket.error} onRetry={() => ticket.refetch()} />;
  const t = ticket.data;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await reply.mutateAsync(body.trim());
      setBody("");
    } catch {
      /* shown via reply.error */
    }
  }

  return (
    <div className="page page-narrow">
      <p className="breadcrumb">
        <Link to="/author/tickets">← My Tickets</Link>
      </p>
      {justCreated && <Notice tone="success">Your ticket has been submitted. We'll reply here - no need to refresh.</Notice>}
      <div className="page-head">
        <div>
          <h1>{t.subject}</h1>
          <div className="meta">
            <span className="ticket-id">#{t.id}</span>
            <StatusBadge status={t.status} />
            <span>{t.bookTitle ?? "General / Account Level"}</span>
            <span>{t.category ?? "Being categorised…"}</span>
            <span>
              Priority <PriorityBadge priority={t.priority} />
            </span>
            <span>Opened {formatDate(t.createdAt)}</span>
          </div>
        </div>
      </div>

      <section className="card">
        <TicketThread authorName="You" description={t.description} createdAt={t.createdAt} messages={t.messages} attachments={t.attachments} viewer="author" />
        {t.messages.length === 0 && <p className="muted small">Our team has received your query and will reply here.</p>}
      </section>

      {t.status === "Closed" ? (
        <Notice tone="info">
          This ticket is closed. If you need more help, please <Link to="/author/tickets/new">raise a new ticket</Link>.
        </Notice>
      ) : (
        <form className="card form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="reply">Add a message</label>
            <textarea id="reply" rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
            {t.status === "Resolved" && <p className="field-help">Replying will reopen this ticket.</p>}
          </div>
          {reply.isError && <Notice tone="error">{errorMessage(reply.error)}</Notice>}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={reply.isPending || !body.trim()}>
              {reply.isPending && <Spinner label="Sending" />}
              Send message
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
