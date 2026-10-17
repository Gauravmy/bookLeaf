import { Link } from "react-router-dom";
import type { Book } from "../../../../shared/domain";
import { useMyBooks } from "../../api/queries";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui";
import { formatDate, formatINR, formatNumber } from "../../lib/format";

const inProduction = (b: Book) => b.status.startsWith("In Production");

function BookStatus({ book }: { book: Book }) {
  return <span className={`badge ${inProduction(book) ? "book-production" : "book-live"}`}>{book.status}</span>;
}

export function BooksPage() {
  const books = useMyBooks();
  if (books.isPending) return <LoadingBlock label="Loading your books…" />;
  if (books.isError) return <ErrorState error={books.error} onRetry={() => books.refetch()} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Books</h1>
          <p className="muted">Sales and royalty figures as recorded by BookLeaf.</p>
        </div>
      </div>
      {books.data.length === 0 ? (
        <EmptyState title="No books on your account yet" />
      ) : (
        <div className="book-grid">
          {books.data.map((b) => (
            <article key={b.id} className="card book">
              <header className="book-head">
                <div>
                  <h2>{b.title}</h2>
                  <p className="muted small">
                    {b.genre ?? "Genre not set"} · ISBN {b.isbn ?? "not assigned"}
                  </p>
                </div>
                <BookStatus book={b} />
              </header>
              {inProduction(b) && (
                <p className="notice notice-info small">
                  This book is still in production, so it has no publication date, price or sales yet. We email you at each stage.
                </p>
              )}
              <dl className="facts">
                <div>
                  <dt>Published</dt>
                  <dd>{b.publicationDate ? formatDate(b.publicationDate) : "Not yet"}</dd>
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
                  <dt>Royalty earned</dt>
                  <dd>{formatINR(b.totalRoyaltyEarned)}</dd>
                </div>
                <div>
                  <dt>Royalty paid</dt>
                  <dd>{formatINR(b.royaltyPaid)}</dd>
                </div>
                <div>
                  <dt>Royalty pending</dt>
                  <dd className={b.royaltyPending > 0 ? "strong" : undefined}>{formatINR(b.royaltyPending)}</dd>
                </div>
                <div>
                  <dt>Last payout</dt>
                  <dd>{b.lastRoyaltyPayoutDate ? formatDate(b.lastRoyaltyPayoutDate) : b.totalRoyaltyEarned > 0 ? "No payout yet" : "—"}</dd>
                </div>
                <div>
                  <dt>Available on</dt>
                  <dd>{b.availableOn.length ? b.availableOn.join(", ") : "Not listed yet"}</dd>
                </div>
              </dl>
              <footer className="book-foot">
                <Link to={`/author/tickets/new?book=${b.id}`} className="btn btn-secondary btn-sm">
                  Ask about this book
                </Link>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
