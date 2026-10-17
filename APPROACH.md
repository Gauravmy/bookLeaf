# Approach

**What I prioritised.** Following the brief's advice, I built the core ticket loop end to end first: author raises a ticket → automatic triage → admin reviews an AI draft → reply reaches the author live. Then I spent the most effort on the two highest-weighted areas, AI integration and architecture. Authorization, null-safe handling of the dataset (books in production, zero royalties, never-paid authors) and honest failure behaviour came before visual polish.

**Architecture and trade-offs.**
- *One deployable unit.* An Express 5 API serves a React SPA from the same origin, so there's no CORS setup and the cookie can be SameSite=Lax. Routes only validate (zod) and delegate; business logic lives in `services/`, AI in `ai/`, persistence in SQL behind those services.
- *SQLite over Postgres.* Reviewers can run it with `npm install` and no database server, and the schema still uses foreign keys and CHECK constraints. The cost is single-instance scaling; the migration path is documented.
- *Server-Sent Events over WebSockets.* Updates only flow server → browser. Events carry just a ticket ID, so clients refetch through the normal authorised endpoints and the push channel can't leak data.
- *Opaque DB-backed sessions over JWTs*, so logout really revokes access. Only token hashes are stored.

**How the AI works.** Three separate prompts with structured, schema-validated output:
1. *Classification* returns one of the six categories, without the knowledge base (it isn't needed for this).
2. *Priority* uses an urgency rubric plus the policy rules that affect urgency (ISBN errors are always high).
3. *Drafting* uses the tone guide, **only the KB sections for the ticket's category**, and a fact sheet the server computes from the database (royalty figures, last payout or "none recorded", production status, policy-derived payout deadline, the ₹1,000 threshold).

The prompt forbids claiming that any payment, refund, reprint, re-sync, escalation or status change has happened. Anything the agent must verify goes into a checklist shown beside the draft. Triage runs in the background after the ticket is saved. Drafts are generated once when a ticket is opened, cached, and regenerated only after the author writes again, so a typical ticket costs three small Haiku calls (classify, prioritise, draft). Nothing is sent without an explicit admin action.

**When AI or other services fail.** Ticket creation never depends on the model. Timeouts, rate limits, outages, bad credentials and malformed or refused output all map to typed errors. Triage then falls back to a keyword classifier, clearly labelled "RULES" with the reason shown, and can be re-run later without overwriting admin edits. Drafting returns `503 ai_unavailable` and the composer becomes a plain manual editor. With no API key at all, the app is fully usable in this mode.

**Honest status.** All 55 automated tests pass, covering authorization, the lifecycle, the SSE path and AI fallbacks (with a fake provider). The rules fallback scores 96% on category and 70% on priority on a 27-ticket labelled set that I wrote alongside the rules, so these numbers are optimistic. The live LLM path has **not** been exercised, because no API key was available; the README says how to measure it.

**Next steps for production.** Measure and monitor LLM accuracy, using admin overrides as a feedback signal. Move to Postgres plus a shared pub/sub and a durable job queue for triage. Add email notifications and password reset. Move attachments to object storage with scanning. Add business-hours SLAs, and give the drafting prompt richer verified data (per-platform royalty breakdown, bank-link status), so replies can be specific without guessing.
