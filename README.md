# BookLeaf Author Support & Communication Portal

A web application for BookLeaf Publishing with two interfaces:

- **Author portal**: authors sign in, see their books and royalty figures, raise support tickets (optionally with an attachment), and follow replies live.
- **Admin portal**: the operations team works a shared ticket queue with automatic AI classification and priority, AI-drafted replies grounded in the BookLeaf knowledge base, assignment, internal notes and status management.

It is seeded with the exact 10 authors and 18 books from `bookleaf_sample_data.json`.

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Running locally](#running-locally)
4. [Demo accounts](#demo-accounts)
5. [AI integration](#ai-integration)
6. [API reference](#api-reference)
7. [Security](#security)
8. [Testing and quality checks](#testing-and-quality-checks)
9. [Deployment](#deployment)
10. [Known limitations and next steps](#known-limitations-and-next-steps)

---

## Features

### Author portal
| Feature | Notes |
|---|---|
| Email/password sign-in | scrypt-hashed passwords, httpOnly session cookie |
| Dashboard | Book count (live / in production), copies sold, royalty earned / paid / pending, recent tickets - all computed from the author's own records |
| My Books | Title, ISBN, genre, publication date, status, MRP, copies sold, royalty earned / paid / pending, last payout, platforms. Books still in production show "Not set / Not yet" instead of empty values |
| Raise a ticket | Book dropdown with **General / Account Level**, subject, description, optional attachment (PNG/JPEG/WEBP/PDF ≤ 5 MB, actually uploaded and stored) |
| My Tickets | Original query, status, category, priority and every admin reply; follow-up messages (a reply reopens a *Resolved* ticket; *Closed* tickets are final) |
| Live updates | Server-Sent Events; a reply from the team appears without refreshing. Falls back to 20-second polling while disconnected |

### Admin portal
| Feature | Notes |
|---|---|
| Ticket queue | Filters: status, category, priority, assignee (me / unassigned), created-date range, overdue only; free-text search (subject, description, author, book, `AUTH007`, `#12`); sort by urgency / oldest / newest / updated; pagination. Filters live in the URL |
| Urgent & overdue visibility | Default sort = unresolved → overdue → priority → longest waiting. Overdue rows get a red edge and badge |
| Metrics | Open, In progress, Overdue, Critical/High open, Unassigned, average first-response time - all from real ticket data |
| Auto-classification | Exactly the six required categories, via the LLM, with a labelled keyword fallback |
| Auto-priority | Critical / High / Medium / Low, via a separate LLM prompt, with a fallback |
| Overrides | Admins can change category and priority; overrides are labelled "Edited" and never overwritten by re-triage |
| AI-drafted reply | Generated when the ticket is opened, grounded in the knowledge base plus the author's verified book data, with a "before sending, check" list. Editable; sending requires an explicit confirmation |
| Ticket management | Status (Open / In Progress / Resolved / Closed, with confirmation before closing), assign to self or another admin, internal notes, activity log |

### Overdue rule
A ticket is overdue when it is *Open* or *In Progress*, the author is waiting for a BookLeaf reply, and the wait exceeds the target for its priority: Critical 4h, High 24h, Medium 48h, Low 72h. These targets are internal settings I chose (`shared/domain.ts`), not knowledge-base policy, and are never shown to authors.

---

## Architecture

```
React SPA (Vite) ──fetch / EventSource──▶ Express 5 API ──▶ SQLite (better-sqlite3)
                     same origin                │
                                                └──▶ Anthropic Messages API (server-side only)
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + React Router + TanStack Query | Query caching makes "invalidate on event, refetch" live updates simple |
| Backend | Node 22 / Express 5 / TypeScript | Express 5 forwards async errors to the error handler; one language end to end |
| Database | SQLite via better-sqlite3 | No external service to install for reviewers; real SQL schema with foreign keys and CHECK constraints. See limitations for the Postgres path |
| Validation | zod | One schema library for request bodies, query strings, env config and LLM output |
| AI | Anthropic Claude Haiku 5.5 (`claude-haiku-5-5`) | See [model choice](#model-choice) |
| Real time | Server-Sent Events | One-directional server → browser updates are all we need; works through proxies, auto-reconnects |

The SPA and API are served from **one origin** in production, so there is no CORS configuration and the session cookie can be `SameSite=Lax`.

### Project structure
```
shared/domain.ts          Categories, priorities, statuses, DTO types shared by API and UI
server/
  index.ts                Entry point (config, DB, optional seed, listen)
  app.ts                  createApp(): middleware, routes, static SPA - injectable for tests
  config.ts               Env parsing/validation
  db/                     Schema (idempotent) and connection
  auth/                   Password hashing, sessions, auth/role/origin middleware
  routes/                 HTTP layer: validation + calling services (auth, author, admin)
  services/               Business logic: tickets (author), adminTickets, triage, drafts, books
  ai/                     provider.ts (LLM adapter), prompts.ts, knowledgeBase.ts,
                          accountFacts.ts (verified facts for prompts), rules.ts (fallback)
  realtime/bus.ts         SSE pub/sub
  seed/                   Sample-data import + optional sample tickets
web/src/                  React app (api/, lib/, components/, pages/author, pages/admin)
tests/                    Vitest + supertest API tests
scripts/                  Classifier evaluation + labelled set
docs/openapi.yaml         OpenAPI 3.1 specification
```

### Data model
`authors`, `books` (IDs and values exactly as in the dataset) · `users` (login accounts; an author user is linked to exactly one author, admins to none, enforced by a CHECK) · `sessions` (only a SHA-256 of the token is stored) · `tickets` (with `category_source` / `priority_source` = `pending | ai | rules | admin`) · `ticket_messages` (author-visible conversation) · `internal_notes` (separate table, so no author query can select them by accident) · `ticket_attachments` · `ai_drafts` (one cached draft per ticket) · `ticket_events` (audit log).

---

## Running locally

**Prerequisites:** Node.js 22.9 or newer (developed on 22.19) and npm. Nothing else; SQLite is embedded. `better-sqlite3` ships prebuilt binaries for common platforms.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` and set `SEED_DEMO_PASSWORD` to a value of your choice (≥ 10 characters). Optionally set `ANTHROPIC_API_KEY`.

```bash
npm run seed
```

Imports the dataset and creates the demo accounts. It prints the record counts (expected: 10 authors, 18 books, 12 users) and is safe to run repeatedly.

Optional: file the brief's seven sample queries as tickets, so the admin queue isn't empty:

```bash
npm run seed:sample-tickets
```

Start the API and Vite dev server with hot reload, then open http://localhost:5173:

```bash
npm run dev
```

Or run the production build on http://localhost:4000:

```bash
npm run build
```

```bash
npm start
```

To start over, delete `bookleaf.db*` and re-run the seed.

---

## Demo accounts

The dataset contains no passwords, so `npm run seed` provisions **development/demo** accounts. All of them use the password **you** set in `SEED_DEMO_PASSWORD`; nothing is hard-coded.

| Role | Email |
|---|---|
| Admin | `admin@bookleaf.test` (Support Admin) |
| Admin | `ops@bookleaf.test` (Operations Lead) |
| Author | The 10 author emails from the dataset, e.g. `priya.sharma@email.com` (AUTH001), `sneha.kulkarni@email.com` (AUTH007, has a book in production), `kavita.deshmukh@email.com` (AUTH009, ₹850 pending, below the payout threshold), `ananya.reddy@email.com` (AUTH003, never paid) |

- Re-running the seed does **not** change existing passwords. After changing `SEED_DEMO_PASSWORD`, run `npm run seed -- --reset-passwords`.
- With `NODE_ENV=production` the seed refuses the `.env.example` placeholder password.
- For the hosted demo, choose a password, set it in the host's environment, and publish it in your submission notes. These are throwaway demo accounts, never real credentials.

---

## AI integration

All AI code is in `server/ai/` and `server/services/{triage,drafts}.ts`. The browser never talks to the provider and never receives the key.

### Flow
1. **Ticket created.** The API stores the ticket and responds `201` straight away. Triage runs in the background, so a slow or failing provider never delays or blocks ticket creation.
2. **Classification** (prompt 1): category only. The prompt holds the six category definitions; no knowledge base is needed for this.
3. **Priority** (prompt 2): a separate prompt with the urgency rubric and the policy rules that affect priority (e.g. "ISBN errors are always high priority"). It receives the category from step 1.
4. **Admin opens the ticket.** The UI asks for a draft. If a current draft is cached it is returned at no cost; otherwise **drafting** (prompt 3) runs once and the result is stored.
5. **Admin edits and sends.** Nothing is sent to an author unless an admin clicks *Send reply* and confirms.

### Prompt design (`server/ai/prompts.ts`)
- **Three separate prompts**, each with one job and a small zod output schema. They use the Messages API's structured outputs (`output_config.format`), and the server validates the result again with zod before anything reaches the database.
- **Knowledge base as data** (`knowledgeBase.ts`): the brief's KB, split into sections (royalty, ISBN, printing, distribution, production, metadata, company) plus the tone guidelines and the brief's sample response guidance for each category.
- **Minimum context per call**: the draft prompt includes the tone guide, *only the KB sections for the ticket's category*, and that category's calibration guidance. A printing ticket never carries royalty policy.
- **Verified facts, not guesses** (`accountFacts.ts`): the server computes a fact sheet from the database (ISBN, status, MRP or "not set", copies, earned/paid/pending, last payout or "no payout recorded") and, for royalty tickets only, the policy-derived next payout deadline (quarter end + 45 days), the author's total pending amount against the ₹1,000 threshold, and the note that bank details are not visible to the system.
- **Guardrails in the prompt**: use only those facts and policies; policies describe what BookLeaf normally does and are *not* evidence that something happened; never claim a payment, refund, reprint, re-sync, escalation or status change has occurred; never invent dates, amounts or names; phrase actions as what the team *will* do. Anything the admin must verify or do goes into `admin_checklist`, which the UI shows above the editor.
- **Prompt-injection hygiene**: ticket text is wrapped in `<ticket>` tags and every system prompt says to treat it as data. The model's output is only ever a suggestion, constrained to an enum or a draft a human reviews.
- **Tone**: the BookLeaf tone guide is included verbatim: acknowledge first, be specific, own BookLeaf's mistakes, give clear timelines, end with a next step.

### Failure handling and fallback
`provider.ts` maps every SDK failure to one of `not_configured | timeout | rate_limited | unavailable | auth | invalid_output | refused`.

| Situation | Behaviour |
|---|---|
| No `ANTHROPIC_API_KEY` / `AI_ENABLED=false` | App runs normally; triage uses rules; the composer says AI drafting is not configured |
| Timeout (15s default), 429, 5xx, network error | One SDK retry, then fallback. A failed classification skips the priority call, to avoid paying for a second timeout |
| Malformed / truncated / refused output | Treated as a failure; rules are used for triage; the draft endpoint returns `503 ai_unavailable` |
| Draft fails | The composer shows the reason and a retry button; the admin writes the reply manually |

**The rule-based fallback is not AI.** `rules.ts` uses keyword patterns for category and a baseline-per-category plus escalation keywords for priority. Results are stored with source `rules`, shown with an amber **RULES** tag, and the reason AI wasn't used appears on the ticket. An admin can **Re-run AI triage** once the provider is back; overrides are kept.

### Cost awareness
- **Model**: Haiku 5.5 is $0.10 / $0.50 per million input / output tokens (Anthropic list price for prompts ≤ 100K tokens).
- **Measured prompt sizes** (characters ÷ 4 as a rough token estimate): classification ≈ 360 input tokens, priority ≈ 390, draft ≈ 950-1,170 including the ticket. Sending the whole KB and all guidance on every draft would roughly double the draft prompt.
- `effort: "low"` for classification and priority, `"medium"` for drafting; output caps of 1,024 / 4,000 tokens.
- **No duplicate calls**: drafts are cached per ticket and only regenerated when the author has written since (or on an explicit *Regenerate*); concurrent requests for the same ticket share one in-flight call; triage runs once per ticket.
- **Bounded context**: long descriptions are clipped at 3,000 characters; drafts include only the latest 4 conversation turns.
- Per-admin rate limit on AI endpoints (30 / 10 min).
- Every call logs `op`, `model`, input/output tokens, latency and stop reason (never prompt text, ticket content or keys), which gives real usage numbers once deployed.
- Prompt caching is not used: these prompts are below the model's minimum cacheable prefix, so it would save nothing.

### Model choice
**Claude Haiku 5.5**. The work is short classification plus a ~200-word grounded reply, where latency (an admin is waiting) and per-ticket cost matter more than deep reasoning; the brief itself suggests a Haiku-class model. The model is configurable with `AI_MODEL` (e.g. `claude-sonnet-5-5` for higher-quality drafts), and the provider sits behind a small `LlmProvider` interface, so switching providers means one new class.

### Accuracy - what has and hasn't been measured
- `npm run eval:classifier` scores triage against `scripts/labelledTickets.ts`: 27 tickets, 7 from the brief and 20 I wrote.
- **Rule-based fallback** (measured): category 96% (26/27), priority 70% (19/27). The rules and the labelled set were written by the same person, so the category figure is optimistic; expect noticeably lower accuracy on real tickets.
- **LLM triage: not measured.** No API key was available while building this, so the eval's LLM pass, and every live model call, have not been run. Set `ANTHROPIC_API_KEY` and run `npm run eval:classifier` (~54 small calls) to get a real number. I make no accuracy claim for the LLM path until then.
- The AI code paths (prompt contents, KB selection, caching, fallbacks, validation) are covered by automated tests using a fake provider.

---

## API reference

The full specification is in **[`docs/openapi.yaml`](docs/openapi.yaml)** (OpenAPI 3.1; paste it into editor.swagger.io to browse). Summary:

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | Status and whether AI is configured |
| `POST /api/auth/login` | public (rate limited) | Sign in, sets `bl_session` cookie |
| `POST /api/auth/logout` | any | Delete session |
| `GET /api/auth/me` | any | Current user |
| `GET /api/author/profile` · `/summary` · `/books` | author | Own profile, dashboard totals, books |
| `GET /api/author/tickets` · `POST /api/author/tickets` | author | List own / create (JSON or multipart) |
| `GET /api/author/tickets/:id` | author (owner) | One ticket |
| `POST /api/author/tickets/:id/messages` | author (owner) | Follow-up |
| `GET /api/attachments/:id` | owner or admin | Download attachment |
| `GET /api/events` | any | SSE stream (own tickets for authors, all for admins) |
| `GET /api/admin/stats` · `/admins` | admin | Metrics, assignable admins |
| `GET /api/admin/tickets` | admin | Queue with filters/search/sort/pagination |
| `GET /api/admin/tickets/:id` | admin | Detail incl. notes, activity, book & author |
| `PATCH /api/admin/tickets/:id` | admin | `status`, `category`, `priority`, `assigneeId` (unknown keys rejected) |
| `POST /api/admin/tickets/:id/messages` | admin | Send reply (optional `status`) |
| `POST /api/admin/tickets/:id/notes` | admin | Internal note |
| `GET` / `POST /api/admin/tickets/:id/draft` | admin (POST rate limited) | Cached draft / generate (`{ force }`) |
| `POST /api/admin/tickets/:id/triage` | admin (rate limited) | Re-run AI triage |

**Errors** are always `{ "error": { "code", "message", "details?" } }`: `400 validation_error` (with per-field details), `401 unauthorized` / `invalid_credentials`, `403 forbidden`, `404 not_found`, `409 conflict`, `413 file_too_large`, `429 rate_limited`, `503 ai_unavailable`, `500 internal_error` (no stack traces; details are logged server-side).

---

## Security

- **Passwords**: scrypt (N=2^15, r=8), per-password salt, constant-time compare; logins for unknown emails also run a hash so timing doesn't reveal which accounts exist; the same error is returned either way.
- **Sessions**: 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production); only its SHA-256 is stored; logout deletes it server-side; 12h expiry; expired sessions are purged.
- **Authorization on the server**: `requireAuth(role)` on every router; author queries are always filtered by `author_id` in SQL; another author's records return 404; a book ID on a new ticket must belong to the author; assignees must be admins.
- **Internal notes** live in their own table and are never selected by author endpoints; tests assert they never appear in author responses. SSE events carry IDs only.
- **Input handling**: zod on every body, query and route param; `.strict()` schemas reject mass assignment; parameterised SQL everywhere (sort columns come from a whitelist; LIKE wildcards are escaped); 100 KB JSON limit.
- **Uploads**: one file, ≤ 5 MB, type checked by magic bytes (not the client's MIME type), filename sanitised, downloaded with `Content-Disposition: attachment` and `nosniff`.
- **CSRF**: SameSite=Lax cookie plus an `Origin` check on state-changing requests (`ALLOWED_ORIGINS`).
- **Headers**: helmet defaults (CSP, frame-ancestors, etc.); `Cache-Control: no-store` on API responses.
- **Rate limiting**: login (per IP+email and per IP) and AI endpoints (per admin).
- **Secrets**: only in environment variables; `.env` is git-ignored; `.env.example` has placeholders only; the API key is never sent to the browser or logged.

---

## Testing and quality checks

| Command | What it does |
|---|---|
| `npm test` | Vitest + supertest: 55 tests over an in-memory database |
| `npm run typecheck` | `tsc` for server, tests, scripts and web |
| `npm run lint` | ESLint (typescript-eslint, react-hooks) |
| `npm run build` | Vite production build + server compile |
| `npm run eval:classifier` | Triage accuracy on the labelled set |

Test coverage includes: seed counts, idempotency and exact null preservation; login success and failure, rate limiting, origin check, logout; cross-author isolation for tickets, books, replies and attachments; every admin endpoint rejecting authors; internal-note privacy; full ticket lifecycle; validation and mass assignment; queue filters, search, sort and pagination; overdue logic; AI triage success, every failure kind, malformed output, override preservation; draft grounding (policy sections and facts present, unrelated policy absent), caching/staleness/dedupe, 503 fallback plus manual reply; SSE delivery to the right author only.

---

## Deployment

The app is one Node process that serves both the API and the built SPA, so it runs on any Node host with a writable disk. A `render.yaml` blueprint is included.

**Render (blueprint)**: push to GitHub, then in Render choose *New → Blueprint* and pick the repo. Set the secret env vars when prompted (`SEED_DEMO_PASSWORD`, `ANTHROPIC_API_KEY`, and `ALLOWED_ORIGINS` = your service URL). The blueprint mounts a 1 GB disk for SQLite and runs the idempotent seed on boot.

**Any Node host (manual)**:

```bash
npm ci --include=dev && npm run build
```

```bash
npm start
```

Required environment variables in production:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_PATH` | Path on a persistent disk, e.g. `/var/data/bookleaf.db` |
| `SEED_DEMO_PASSWORD` | Your demo password (not the placeholder) |
| `SEED_ON_START` | `true` (idempotent; needed if the disk can be wiped) |
| `ALLOWED_ORIGINS` | Your public URL, e.g. `https://bookleaf-support.onrender.com` |
| `TRUST_PROXY` | `true` behind Render / Railway / nginx |
| `ANTHROPIC_API_KEY` | Optional; without it the app runs in rules + manual-reply mode |
| `PORT` | Usually set by the host |

Without a persistent disk (e.g. Render's free tier) the database resets on each deploy or restart; `SEED_ON_START=true` restores the dataset and accounts, but tickets are lost.

> **Deployment status:** no live deployment has been made from this workspace; there is no live URL yet.

---

## Known limitations and next steps

- **SQLite, single instance.** Fine for a demo and modest load. Next: PostgreSQL (the schema is plain SQL; queries are isolated in `services/`), then Redis or Postgres LISTEN/NOTIFY for the SSE bus so multiple instances can run.
- **LLM accuracy unmeasured** (see above). Next: run the eval with a key, grow the labelled set from real tickets, and track admin overrides as a live accuracy signal.
- **Background triage is in-process.** If the server stops mid-call, a ticket stays `pending` until an admin re-runs triage. Next: a small job queue with retries.
- **No email notifications** to authors or admins; no password reset or account self-service.
- **Attachments are stored in SQLite** (fine at ≤ 5 MB, single file per ticket). Next: object storage (S3) with virus scanning.
- **Overdue targets are fixed constants**, not business-hours aware.
- Draft quality would benefit from per-platform royalty breakdowns and bank-detail status, which the dataset doesn't include; the prompt tells the model to say so rather than guess.
