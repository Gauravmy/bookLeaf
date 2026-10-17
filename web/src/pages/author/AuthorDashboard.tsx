import { Link } from "react-router-dom";
import { useAuthorProfile, useAuthorSummary, useMyTickets } from "../../api/queries";
import { ErrorState, LoadingBlock, Stat, StatusBadge } from "../../components/ui";
import { formatDate, formatINR, formatNumber, timeAgo } from "../../lib/format";

export function AuthorDashboard() {
  const profile = useAuthorProfile();
  const summary = useAuthorSummary();
  const tickets = useMyTickets();

  if (summary.isPending || profile.isPending) return <LoadingBlock />;
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  const s = summary.data;
  const firstName = profile.data.name.split(" ")[0];
  const recent = (tickets.data ?? []).slice(0, 4);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Welcome back, {firstName}</h1>
          <p className="muted">
            Author since {formatDate(profile.data.joinedDate)}
            {profile.data.city ? ` · ${profile.data.city}` : ""}
          </p>
        </div>
        <Link to="/author/tickets/new" className="btn btn-primary">
          Raise a support ticket
        </Link>
      </div>

      <section aria-label="Account summary" className="stats">
        <Stat label="Books" value={s.books.total} hint={`${s.books.live} live · ${s.books.inProduction} in production`} />
        <Stat label="Copies sold" value={formatNumber(s.copiesSold)} />
        <Stat label="Royalty earned" value={formatINR(s.royaltyEarned)} hint={`${formatINR(s.royaltyPaid)} paid`} />
        <Stat label="Royalty pending" value={formatINR(s.royaltyPending)} />
      </section>

      <p className="policy-note">
        Royalties are calculated quarterly and paid within 45 days of the quarter ending. Balances below ₹1,000 roll over to the
        next quarter.
      </p>

      <section className="card">
        <div className="card-head">
          <h2>Recent tickets</h2>
          <Link to="/author/tickets">View all ({s.tickets.total})</Link>
        </div>
        {tickets.isPending ? (
          <LoadingBlock />
        ) : tickets.isError ? (
          <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
        ) : recent.length === 0 ? (
          <p className="muted">You haven't raised any tickets yet. If something isn't right with a book or payment, we're here to help.</p>
        ) : (
          <ul className="list">
            {recent.map((t) => (
              <li key={t.id}>
                <Link to={`/author/tickets/${t.id}`} className="list-row">
                  <span className="list-main">
                    <span className="list-title">{t.subject}</span>
                    <span className="muted small">
                      {t.bookTitle ?? "General / Account Level"} · updated {timeAgo(t.updatedAt)}
                      {t.messages.some((m) => m.senderRole === "admin") ? " · has replies" : ""}
                    </span>
                  </span>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
