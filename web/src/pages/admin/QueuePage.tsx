import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "../../../../shared/domain";
import { useAdminQueue, useAdminStats } from "../../api/queries";
import { EmptyState, ErrorState, LoadingBlock, PriorityBadge, SourceTag, Spinner, Stat, StatusBadge } from "../../components/ui";
import { formatDateTime, timeAgo } from "../../lib/format";

// Default view: what needs attention. "status=" (empty) means all statuses.
const DEFAULT_STATUS = "Open,In Progress";
const STATUS_OPTIONS = [
  { value: DEFAULT_STATUS, label: "Unresolved" },
  { value: "", label: "All statuses" },
  ...TICKET_STATUSES.map((s) => ({ value: s, label: s })),
];

export function QueuePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("status") ?? DEFAULT_STATUS;

  // Build the API query from the URL so filters survive reloads and can be shared.
  const apiParams = new URLSearchParams(params);
  if (status) apiParams.set("status", status);
  else apiParams.delete("status");
  const queue = useAdminQueue(apiParams);
  const stats = useAdminStats();

  // Search is debounced so the queue doesn't refetch on every keystroke.
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((params.get("q") ?? "") !== search.trim()) update({ q: search.trim() });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [search]);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || (v === "" && k !== "status")) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  }

  const quickFilter = (changes: Record<string, string | null>) => () =>
    setParams(new URLSearchParams(Object.entries(changes).filter(([, v]) => v !== null) as [string, string][]), { replace: true });

  const page = queue.data?.page ?? 1;
  const totalPages = queue.data ? Math.max(1, Math.ceil(queue.data.total / queue.data.pageSize)) : 1;
  const hasFilters = [...params.keys()].some((k) => k !== "sort" && k !== "page");

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Ticket Queue</h1>
          <p className="muted">All author tickets. Overdue and urgent tickets rise to the top by default.</p>
        </div>
      </div>

      {stats.data && (
        <section className="stats stats-6" aria-label="Queue metrics">
          <button className="stat-button" onClick={quickFilter({ status: "Open" })}>
            <Stat label="Open" value={stats.data.open} />
          </button>
          <button className="stat-button" onClick={quickFilter({ status: "In Progress" })}>
            <Stat label="In progress" value={stats.data.inProgress} />
          </button>
          <button className="stat-button" onClick={quickFilter({ status: DEFAULT_STATUS, overdue: "true" })}>
            <Stat label="Overdue" value={stats.data.overdue} tone={stats.data.overdue ? "danger" : undefined} hint="Waiting past target" />
          </button>
          <button className="stat-button" onClick={quickFilter({ status: DEFAULT_STATUS, sort: "urgency" })}>
            <Stat label="Critical / High open" value={stats.data.urgent} tone={stats.data.urgent ? "warn" : undefined} hint="Shown first" />
          </button>
          <button className="stat-button" onClick={quickFilter({ status: DEFAULT_STATUS, assignee: "unassigned" })}>
            <Stat label="Unassigned" value={stats.data.unassigned} />
          </button>
          <Stat
            label="Avg first response"
            value={stats.data.avgFirstResponseHours === null ? "—" : `${stats.data.avgFirstResponseHours}h`}
            hint={stats.data.respondedTickets ? `across ${stats.data.respondedTickets} tickets` : "no replies yet"}
          />
        </section>
      )}

      <section className="card filters" aria-label="Filters">
        <div className="field grow">
          <label htmlFor="q">Search</label>
          <input id="q" type="search" placeholder="Subject, author, book, AUTH007 or #12" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={status} onChange={(e) => update({ status: e.target.value })}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-category">Category</label>
          <select id="f-category" value={params.get("category") ?? ""} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-priority">Priority</label>
          <select id="f-priority" value={params.get("priority") ?? ""} onChange={(e) => update({ priority: e.target.value })}>
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-assignee">Assignee</label>
          <select id="f-assignee" value={params.get("assignee") ?? ""} onChange={(e) => update({ assignee: e.target.value })}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">Created from</label>
          <input id="f-from" type="date" value={params.get("createdFrom") ?? ""} onChange={(e) => update({ createdFrom: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-to">Created to</label>
          <input id="f-to" type="date" value={params.get("createdTo") ?? ""} onChange={(e) => update({ createdTo: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="f-sort">Sort</label>
          <select id="f-sort" value={params.get("sort") ?? "urgency"} onChange={(e) => update({ sort: e.target.value })}>
            <option value="urgency">Most urgent first</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={params.get("overdue") === "true"} onChange={(e) => update({ overdue: e.target.checked ? "true" : null })} />
          Overdue only
        </label>
        {hasFilters && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch("");
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Reset filters
          </button>
        )}
      </section>

      {queue.isPending ? (
        <LoadingBlock label="Loading tickets…" />
      ) : queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
      ) : queue.data.items.length === 0 ? (
        <EmptyState title={hasFilters || status ? "No tickets match these filters" : "No tickets yet"}>
          <p className="muted">New author tickets appear here automatically.</p>
        </EmptyState>
      ) : (
        <section className="card table-card">
          <div className="table-meta">
            <span>
              {queue.data.total} ticket{queue.data.total === 1 ? "" : "s"}
            </span>
            {queue.isFetching && <Spinner label="Refreshing" />}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  <th scope="col">Ticket</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assignee</th>
                  <th scope="col">Opened</th>
                </tr>
              </thead>
              <tbody>
                {queue.data.items.map((t) => (
                  <tr
                    key={t.id}
                    className={t.overdue ? "row-overdue" : undefined}
                    onClick={() => navigate(`/admin/tickets/${t.id}`)}
                  >
                    <td>
                      <PriorityBadge priority={t.priority} />
                      {t.priority && <SourceTag source={t.prioritySource} />}
                    </td>
                    <td className="cell-main">
                      <Link to={`/admin/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}>
                        <span className="ticket-id">#{t.id}</span> {t.subject}
                      </Link>
                      <div className="muted small">
                        {t.authorName} · {t.bookTitle ?? "Account level"}
                        {t.messageCount > 0 ? ` · ${t.messageCount} message${t.messageCount === 1 ? "" : "s"}` : ""}
                      </div>
                    </td>
                    <td>
                      {t.category ?? <span className="muted">Triaging…</span>}
                      {t.category && <SourceTag source={t.categorySource} />}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                      {t.overdue && <span className="badge overdue">Overdue</span>}
                    </td>
                    <td>{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                    <td title={formatDateTime(t.createdAt)}>{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Pagination">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
