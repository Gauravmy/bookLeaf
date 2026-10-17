// Domain vocabulary shared by the API and the web client. Keeping the
// enumerations in one place means validation, prompts and UI badges can never
// drift apart.

export const TICKET_CATEGORIES = [
  "Royalty & Payments",
  "ISBN & Metadata Issues",
  "Printing & Quality",
  "Distribution & Availability",
  "Book Status & Production Updates",
  "General Inquiry",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ["Open", "In Progress", "Resolved", "Closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const UNRESOLVED_STATUSES: readonly TicketStatus[] = ["Open", "In Progress"];

/** Where a ticket's category/priority came from, shown to admins so they know what to trust. */
export const TRIAGE_SOURCES = ["pending", "ai", "rules", "admin"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

export type Role = "author" | "admin";

/**
 * Response-time targets (hours) used to flag overdue unresolved tickets.
 * These are internal operating targets chosen for this portal, not policies
 * from the BookLeaf knowledge base, so they are never quoted to authors.
 */
export const RESPONSE_TARGET_HOURS: Record<TicketPriority, number> = {
  Critical: 4,
  High: 24,
  Medium: 48,
  Low: 72,
};

export const PRIORITY_RANK: Record<TicketPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  authorId: string | null;
}

export interface Book {
  id: string;
  authorId: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface AuthorProfile {
  id: string;
  name: string;
  email: string;
  city: string | null;
  joinedDate: string | null;
}

export interface TicketMessage {
  id: number;
  senderRole: Role;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface TicketAttachment {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Fields an author is allowed to see. Admin-only data lives in AdminTicketDetail. */
export interface AuthorTicket {
  id: number;
  subject: string;
  description: string;
  status: TicketStatus;
  category: TicketCategory | null;
  priority: TicketPriority | null;
  bookId: string | null;
  bookTitle: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
}

export interface AdminTicketSummary {
  id: number;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  categorySource: TriageSource;
  priority: TicketPriority | null;
  prioritySource: TriageSource;
  authorId: string;
  authorName: string;
  bookId: string | null;
  bookTitle: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  overdue: boolean;
  messageCount: number;
}

export interface InternalNote {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface TicketEvent {
  id: number;
  actorName: string | null;
  type: string;
  detail: string;
  createdAt: string;
}

export interface AiDraft {
  body: string;
  checklist: string[];
  model: string;
  createdAt: string;
  /** True when the author has written since the draft was generated. */
  stale: boolean;
}

export interface AdminTicketDetail extends AdminTicketSummary {
  description: string;
  triageRationale: string | null;
  triageError: string | null;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  notes: InternalNote[];
  events: TicketEvent[];
  book: Book | null;
  author: AuthorProfile;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
