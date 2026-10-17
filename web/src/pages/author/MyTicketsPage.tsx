import { useState } from "react";
import { Link } from "react-router-dom";
import type { TicketStatus } from "../../../../shared/domain";
import { useMyTickets } from "../../api/queries";
import { EmptyState, ErrorState, LoadingBlock, PriorityBadge, StatusBadge } from "../../components/ui";
import { formatDate, timeAgo } from "../../lib/format";

const FILTERS: { label: string; match: (s: TicketStatus) => boolean }[] = [
  { label: "All", match: () => true },
  { label: "Active", match: (s) => s === "Open" || s === "In Progress" },
  { label: "Resolved & closed", match: (s) => s === "Resolved" || s === "Closed" },
];

export function MyTicketsPage() {
  const tickets = useMyTickets();
  const [filter, setFilter] = useState(0);
  if (tickets.isPending) return <LoadingBlock label="Loading your tickets…" />;
  if (tickets.isError) return <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />;
  const visible = tickets.data.filter((t) => FILTERS[filter]!.match(t.status));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Tickets</h1>
          <p className="muted">Replies from the BookLeaf team appear here automatically.</p>
        </div>
        <Link to="/author/tickets/new" className="btn btn-primary">
          New ticket
        </Link>
      </div>

      {tickets.data.length === 0 ? (
        <EmptyState title="No tickets yet">
          <p>
            Have a question about royalties, your ISBN, printing or your book's status? <Link to="/author/tickets/new">Raise a ticket</Link>.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="segmented" role="group" aria-label="Filter tickets">
            {FILTERS.map((f, i) => (
              <button key={f.label} className={i === filter ? "active" : ""} aria-pressed={i === filter} onClick={() => setFilter(i)}>
                {f.label}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState title="No tickets match this filter" />
          ) : (
            <ul className="ticket-cards">
              {visible.map((t) => {
                const replies = t.messages.filter((m) => m.senderRole === "admin").length;
                return (
                  <li key={t.id}>
                    <Link to={`/author/tickets/${t.id}`} className="card ticket-card">
                      <div className="ticket-card-top">
                        <span className="ticket-id">#{t.id}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <h2 className="ticket-card-title">{t.subject}</h2>
                      <p className="ticket-card-desc">{t.description}</p>
                      <div className="meta">
                        <span>{t.bookTitle ?? "General / Account Level"}</span>
                        <span>{t.category ?? "Being categorised…"}</span>
                        <span>
                          Priority <PriorityBadge priority={t.priority} />
                        </span>
                        <span>Opened {formatDate(t.createdAt)}</span>
                        <span className={replies ? "strong" : undefined}>
                          {replies ? `${replies} ${replies === 1 ? "reply" : "replies"} · ${timeAgo(t.updatedAt)}` : "Awaiting reply"}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
