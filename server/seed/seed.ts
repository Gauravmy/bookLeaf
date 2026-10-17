import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DB } from "../db/connection.js";
import { nowIso } from "../db/connection.js";
import { hashPassword } from "../auth/passwords.js";

// Mirrors bookleaf_sample_data.json exactly; validation fails loudly if the
// file shape changes instead of silently importing partial data.
const BookSchema = z.object({
  book_id: z.string(),
  title: z.string(),
  isbn: z.string().nullable(),
  genre: z.string().nullable(),
  publication_date: z.string().nullable(),
  status: z.string(),
  mrp: z.number().nullable(),
  author_royalty_per_copy: z.number().nullable(),
  total_copies_sold: z.number(),
  total_royalty_earned: z.number(),
  royalty_paid: z.number(),
  royalty_pending: z.number(),
  last_royalty_payout_date: z.string().nullable(),
  print_partner: z.string().nullable(),
  available_on: z.array(z.string()),
});
const AuthorSchema = z.object({
  author_id: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  joined_date: z.string().nullable(),
  books: z.array(BookSchema),
});
export const SampleDataSchema = z.object({ authors: z.array(AuthorSchema) });
export type SampleData = z.infer<typeof SampleDataSchema>;

/** Development/demo admin accounts. They share SEED_DEMO_PASSWORD with the author accounts. */
export const DEMO_ADMINS = [
  { email: "admin@bookleaf.test", name: "Support Admin" },
  { email: "ops@bookleaf.test", name: "Operations Lead" },
] as const;

// The value shipped in .env.example. Refusing it in production stops a
// placeholder from becoming a real, publicly known password.
export const EXAMPLE_PASSWORD_PLACEHOLDER = "replace-with-a-local-demo-password";

export interface SeedOptions {
  demoPassword: string | undefined;
  production: boolean;
  /** Re-hash passwords of existing demo accounts (e.g. after rotating SEED_DEMO_PASSWORD). */
  resetPasswords?: boolean;
}

export interface SeedResult {
  authors: number;
  books: number;
  usersCreated: number;
  usersUpdated: number;
}

export function loadSampleData(path: string): SampleData {
  return SampleDataSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function validateDemoPassword(password: string | undefined, production: boolean): string {
  if (!password) {
    throw new Error("SEED_DEMO_PASSWORD is not set. Add it to your .env file (see .env.example) and re-run the seed.");
  }
  if (password.length < 10) throw new Error("SEED_DEMO_PASSWORD must be at least 10 characters.");
  if (production && password === EXAMPLE_PASSWORD_PLACEHOLDER) {
    throw new Error("SEED_DEMO_PASSWORD still has the .env.example placeholder; choose a real value for production.");
  }
  return password;
}

/**
 * Idempotent import: authors and books are upserted by their dataset IDs, so
 * re-running never duplicates rows and always restores the supplied figures.
 * Tickets and other operational data are never touched.
 */
export async function seedDatabase(db: DB, data: SampleData, options: SeedOptions): Promise<SeedResult> {
  const password = validateDemoPassword(options.demoPassword, options.production);
  const passwordHash = await hashPassword(password);

  const upsertAuthor = db.prepare(`
    INSERT INTO authors (id, name, email, phone, city, joined_date)
    VALUES (@author_id, @name, @email, @phone, @city, @joined_date)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, phone = excluded.phone,
      city = excluded.city, joined_date = excluded.joined_date`);
  const upsertBook = db.prepare(`
    INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp, author_royalty_per_copy,
      total_copies_sold, total_royalty_earned, royalty_paid, royalty_pending, last_royalty_payout_date,
      print_partner, available_on)
    VALUES (@book_id, @author_id, @title, @isbn, @genre, @publication_date, @status, @mrp, @author_royalty_per_copy,
      @total_copies_sold, @total_royalty_earned, @royalty_paid, @royalty_pending, @last_royalty_payout_date,
      @print_partner, @available_on)
    ON CONFLICT(id) DO UPDATE SET author_id = excluded.author_id, title = excluded.title, isbn = excluded.isbn,
      genre = excluded.genre, publication_date = excluded.publication_date, status = excluded.status,
      mrp = excluded.mrp, author_royalty_per_copy = excluded.author_royalty_per_copy,
      total_copies_sold = excluded.total_copies_sold, total_royalty_earned = excluded.total_royalty_earned,
      royalty_paid = excluded.royalty_paid, royalty_pending = excluded.royalty_pending,
      last_royalty_payout_date = excluded.last_royalty_payout_date, print_partner = excluded.print_partner,
      available_on = excluded.available_on`);
  const findUser = db.prepare("SELECT id FROM users WHERE email = ?");
  const insertUser = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updatePassword = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");

  const result: SeedResult = { authors: 0, books: 0, usersCreated: 0, usersUpdated: 0 };
  const provision = (email: string, name: string, role: "author" | "admin", authorId: string | null) => {
    const existing = findUser.get(email) as { id: number } | undefined;
    if (!existing) {
      insertUser.run(email, name, passwordHash, role, authorId, nowIso());
      result.usersCreated++;
    } else if (options.resetPasswords) {
      updatePassword.run(passwordHash, existing.id);
      result.usersUpdated++;
    }
  };

  db.transaction(() => {
    for (const author of data.authors) {
      upsertAuthor.run(author);
      result.authors++;
      for (const book of author.books) {
        upsertBook.run({ ...book, author_id: author.author_id, available_on: JSON.stringify(book.available_on) });
        result.books++;
      }
      provision(author.email, author.name, "author", author.author_id);
    }
    for (const admin of DEMO_ADMINS) provision(admin.email, admin.name, "admin", null);
  })();

  return result;
}

export function countRecords(db: DB) {
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { authors: count("authors"), books: count("books"), users: count("users") };
}
