import type { Book } from "../../shared/domain.js";

/**
 * Facts the system can actually verify, computed deterministically on the
 * server and handed to the drafting prompt. The model is told to rely on these
 * (and the policies) rather than invent numbers, dates or statuses.
 */

export const MIN_PAYOUT_THRESHOLD_INR = 1000;
const PAYOUT_WINDOW_DAYS = 45;

export interface PayoutSchedule {
  quarterLabel: string;
  quarterEnd: string;
  payoutDueBy: string;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Quarterly cycle per the royalty policy: royalties for a quarter are paid
 * within 45 days of the quarter ending. Returns the most relevant upcoming
 * deadline - the last completed quarter's if it has not passed yet, otherwise
 * the current quarter's. Calendar quarters are assumed (Indian fiscal quarters
 * share the same boundaries).
 */
export function nextPayoutSchedule(today: Date): PayoutSchedule {
  const year = today.getUTCFullYear();
  const quarterIndex = Math.floor(today.getUTCMonth() / 3); // 0..3, current quarter
  const quarterEndFor = (y: number, q: number) => new Date(Date.UTC(y, q * 3 + 3, 0)); // last day of quarter

  const prevQ = quarterIndex === 0 ? 3 : quarterIndex - 1;
  const prevY = quarterIndex === 0 ? year - 1 : year;
  const prevEnd = quarterEndFor(prevY, prevQ);
  const prevDue = new Date(prevEnd.getTime() + PAYOUT_WINDOW_DAYS * 86400_000);

  if (today <= prevDue) {
    return { quarterLabel: `Q${prevQ + 1} ${prevY}`, quarterEnd: fmt(prevEnd), payoutDueBy: fmt(prevDue) };
  }
  const curEnd = quarterEndFor(year, quarterIndex);
  const curDue = new Date(curEnd.getTime() + PAYOUT_WINDOW_DAYS * 86400_000);
  return { quarterLabel: `Q${quarterIndex + 1} ${year}`, quarterEnd: fmt(curEnd), payoutDueBy: fmt(curDue) };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Plain-text fact sheet for one book. Null values are stated explicitly rather than guessed. */
export function describeBook(book: Book): string {
  const lines = [
    `Title: ${book.title} (book ID ${book.id})`,
    `ISBN on record: ${book.isbn ?? "not yet assigned"}`,
    `Production status: ${book.status}`,
    `Publication date: ${book.publicationDate ?? "not yet published"}`,
    `MRP: ${book.mrp === null ? "not set (book still in production)" : inr(book.mrp)}`,
    `Copies sold: ${book.totalCopiesSold}`,
    `Royalty earned: ${inr(book.totalRoyaltyEarned)}; paid: ${inr(book.royaltyPaid)}; pending: ${inr(book.royaltyPending)}`,
    `Last royalty payout: ${book.lastRoyaltyPayoutDate ?? "no payout recorded yet"}`,
    `Print partner: ${book.printPartner ?? "not assigned yet"}`,
    `Listed on: ${book.availableOn.length ? book.availableOn.join(", ") : "not listed on any platform yet"}`,
  ];
  return lines.join("\n");
}

export interface AuthorRoyaltySummary {
  totalPending: number;
  booksWithNoPayout: number;
}

export function summariseRoyalties(books: Book[]): AuthorRoyaltySummary {
  return {
    totalPending: books.reduce((sum, b) => sum + b.royaltyPending, 0),
    booksWithNoPayout: books.filter((b) => b.totalRoyaltyEarned > 0 && b.lastRoyaltyPayoutDate === null).length,
  };
}

/** Royalty facts that only make sense for royalty tickets; kept out of other prompts to save tokens. */
export function describeRoyaltyContext(books: Book[], today: Date): string {
  const schedule = nextPayoutSchedule(today);
  const summary = summariseRoyalties(books);
  const lines = [
    `Today's date: ${fmt(today)}`,
    `Per policy, royalties for ${schedule.quarterLabel} (quarter ending ${schedule.quarterEnd}) are due to be paid by ${schedule.payoutDueBy}. This is the policy deadline, not a confirmed transfer.`,
    `Author's total pending royalty across all books: ${inr(summary.totalPending)} (payout threshold ${inr(MIN_PAYOUT_THRESHOLD_INR)}).`,
  ];
  if (summary.totalPending > 0 && summary.totalPending < MIN_PAYOUT_THRESHOLD_INR) {
    lines.push("The pending total is below the threshold, so under policy it rolls over to the next quarter.");
  }
  if (summary.booksWithNoPayout > 0) {
    lines.push(`${summary.booksWithNoPayout} book(s) have earned royalty but have no payout recorded yet.`);
  }
  lines.push("Bank account details are not visible to this system; ask the author to confirm they are linked if relevant.");
  return lines.join("\n");
}
