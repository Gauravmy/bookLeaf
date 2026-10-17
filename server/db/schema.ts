// Schema is applied idempotently on startup. Timestamps are ISO-8601 UTC strings,
// which sort correctly as text. Money values are whole rupees, as in the dataset.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS authors (
  id           TEXT PRIMARY KEY,            -- e.g. AUTH001, from the sample dataset
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone        TEXT,
  city         TEXT,
  joined_date  TEXT
);

CREATE TABLE IF NOT EXISTS books (
  id                         TEXT PRIMARY KEY,  -- e.g. BK001
  author_id                  TEXT NOT NULL REFERENCES authors(id),
  title                      TEXT NOT NULL,
  isbn                       TEXT,
  genre                      TEXT,
  publication_date           TEXT,              -- NULL while in production
  status                     TEXT NOT NULL,
  mrp                        INTEGER,           -- NULL while in production
  author_royalty_per_copy    INTEGER,
  total_copies_sold          INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned       INTEGER NOT NULL DEFAULT 0,
  royalty_paid               INTEGER NOT NULL DEFAULT 0,
  royalty_pending            INTEGER NOT NULL DEFAULT 0,
  last_royalty_payout_date   TEXT,
  print_partner              TEXT,
  available_on               TEXT NOT NULL DEFAULT '[]'  -- JSON array of platform names
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('author', 'admin')),
  author_id      TEXT UNIQUE REFERENCES authors(id),
  created_at     TEXT NOT NULL,
  -- An author login must be linked to an author record; admins never are.
  CHECK ((role = 'author' AND author_id IS NOT NULL) OR (role = 'admin' AND author_id IS NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,   -- SHA-256 of the cookie token; the raw token is never stored
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tickets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id          TEXT NOT NULL REFERENCES authors(id),
  book_id            TEXT REFERENCES books(id),   -- NULL = General / Account Level
  subject            TEXT NOT NULL,
  description        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'Open'
                       CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),
  category           TEXT,
  category_source    TEXT NOT NULL DEFAULT 'pending',
  priority           TEXT,
  priority_source    TEXT NOT NULL DEFAULT 'pending',
  triage_rationale   TEXT,
  triage_error       TEXT,
  assignee_id        INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  first_response_at  TEXT,
  -- When the author started waiting for BookLeaf (creation or latest author
  -- follow-up); NULL once an admin has replied. Drives the overdue flag.
  awaiting_since     TEXT,
  resolved_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);

-- Author-visible conversation: admin replies and author follow-ups.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('author', 'admin')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id);

-- Internal notes live in their own table so no author-facing query can
-- accidentally select them.
CREATE TABLE IF NOT EXISTS internal_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  admin_id    INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON internal_notes(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);

-- Cached AI draft per ticket. based_on_message_id records the latest author
-- message the draft answered, so we only regenerate when something changed.
CREATE TABLE IF NOT EXISTS ai_drafts (
  ticket_id            INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body                 TEXT NOT NULL,
  checklist            TEXT NOT NULL DEFAULT '[]',
  model                TEXT NOT NULL,
  based_on_message_id  INTEGER,
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  created_at           TEXT NOT NULL
);

-- Audit trail of admin actions (status changes, overrides, assignment).
CREATE TABLE IF NOT EXISTS ticket_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id),   -- NULL = system (e.g. automatic triage)
  type        TEXT NOT NULL,
  detail      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id);
`;
