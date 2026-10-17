import type { DB } from "../db/connection.js";
import type { AuthorProfile, Book } from "../../shared/domain.js";

interface BookRow {
  id: string;
  author_id: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string;
}

export function toBook(row: BookRow): Book {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    isbn: row.isbn,
    genre: row.genre,
    publicationDate: row.publication_date,
    status: row.status,
    mrp: row.mrp,
    authorRoyaltyPerCopy: row.author_royalty_per_copy,
    totalCopiesSold: row.total_copies_sold,
    totalRoyaltyEarned: row.total_royalty_earned,
    royaltyPaid: row.royalty_paid,
    royaltyPending: row.royalty_pending,
    lastRoyaltyPayoutDate: row.last_royalty_payout_date,
    printPartner: row.print_partner,
    availableOn: JSON.parse(row.available_on) as string[],
  };
}

export function listBooksForAuthor(db: DB, authorId: string): Book[] {
  const rows = db
    .prepare("SELECT * FROM books WHERE author_id = ? ORDER BY publication_date IS NULL, publication_date DESC, id")
    .all(authorId) as BookRow[];
  return rows.map(toBook);
}

export function findBook(db: DB, bookId: string): Book | null {
  const row = db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as BookRow | undefined;
  return row ? toBook(row) : null;
}

export function findAuthor(db: DB, authorId: string): AuthorProfile | null {
  const row = db.prepare("SELECT id, name, email, city, joined_date FROM authors WHERE id = ?").get(authorId) as
    | { id: string; name: string; email: string; city: string | null; joined_date: string | null }
    | undefined;
  return row ? { id: row.id, name: row.name, email: row.email, city: row.city, joinedDate: row.joined_date } : null;
}

/** Short label used in prompts and lists, e.g. "Midnight in Mysore (In Production - Cover Design)". */
export const bookSummary = (book: Book | null) => (book ? `${book.title} (${book.status})` : null);
