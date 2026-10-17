import type { DB } from "../db/connection.js";
import { nowIso } from "../db/connection.js";
import type { AiDraft } from "../../shared/domain.js";
import { HttpError, notFound } from "../lib/errors.js";
import { AiError, type LlmProvider } from "../ai/provider.js";
import { DraftSchema, buildDraftPrompt } from "../ai/prompts.js";
import { classifyByRules } from "../ai/rules.js";
import { describeBook, describeRoyaltyContext } from "../ai/accountFacts.js";
import { bookSummary, findAuthor, findBook, listBooksForAuthor } from "./books.js";
import { getTicketRow, loadMessages } from "./tickets.js";

// Only the latest turns matter for the next reply; the original query is always
// included separately, so older back-and-forth is dropped to save tokens.
const RECENT_MESSAGE_LIMIT = 4;

interface DraftRow {
  body: string;
  checklist: string;
  model: string;
  based_on_message_id: number | null;
  created_at: string;
}

/**
 * Generates and caches one AI draft per ticket. A cached draft is reused until
 * the author writes again, so opening a ticket repeatedly costs nothing extra.
 * Drafts are suggestions only: nothing is sent to the author from here.
 */
export class DraftService {
  private inFlight = new Map<number, Promise<AiDraft>>();

  constructor(
    private readonly db: DB,
    private readonly provider: LlmProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getCached(ticketId: number): AiDraft | null {
    if (!getTicketRow(this.db, ticketId)) throw notFound("Ticket");
    const row = this.db.prepare("SELECT * FROM ai_drafts WHERE ticket_id = ?").get(ticketId) as DraftRow | undefined;
    return row ? this.toDraft(ticketId, row) : null;
  }

  /** Returns the cached draft if still current, otherwise calls the model (unless force=true, which always regenerates). */
  async getOrGenerate(ticketId: number, force: boolean): Promise<AiDraft> {
    const cached = this.getCached(ticketId);
    if (cached && !cached.stale && !force) return cached;

    // Two admins opening the same ticket at once share one model call.
    const pending = this.inFlight.get(ticketId);
    if (pending) return pending;
    const run = this.generate(ticketId).finally(() => this.inFlight.delete(ticketId));
    this.inFlight.set(ticketId, run);
    return run;
  }

  private async generate(ticketId: number): Promise<AiDraft> {
    const ticket = getTicketRow(this.db, ticketId);
    if (!ticket) throw notFound("Ticket");
    const author = findAuthor(this.db, ticket.author_id);
    if (!author) throw notFound("Author");
    const book = ticket.book_id ? findBook(this.db, ticket.book_id) : null;
    // Drafting needs a category to pick policy sections; if triage has not
    // finished yet, use the rules so the admin is not blocked.
    const category =
      ticket.category ?? classifyByRules({ subject: ticket.subject, description: ticket.description, bookSummary: bookSummary(book) }).category;

    const messages = loadMessages(this.db, [ticketId]).get(ticketId) ?? [];
    const lastAuthorMessage = [...messages].reverse().find((m) => m.senderRole === "author");

    const extraFacts =
      category === "Royalty & Payments" ? describeRoyaltyContext(listBooksForAuthor(this.db, author.id), this.clock()) : null;

    const prompt = buildDraftPrompt({
      subject: ticket.subject,
      description: ticket.description,
      bookSummary: bookSummary(book),
      category,
      authorFirstName: author.name.split(" ")[0] ?? author.name,
      bookFacts: book ? describeBook(book) : null,
      extraFacts,
      recentMessages: messages.slice(-RECENT_MESSAGE_LIMIT).map((m) => ({
        from: m.senderRole === "author" ? "author" : "BookLeaf",
        body: m.body,
      })),
    });

    let result;
    try {
      result = await this.provider.generate({
        operation: "draft",
        ...prompt,
        schema: DraftSchema,
        maxTokens: 4000,
        effort: "medium",
      });
    } catch (err) {
      if (err instanceof AiError) {
        // 503 tells the UI to switch to the manual reply workflow.
        throw new HttpError(503, "ai_unavailable", `AI draft unavailable: ${err.message}. You can write the reply manually.`, {
          reason: err.kind,
        });
      }
      throw err;
    }

    const reply = result.data.reply.trim();
    if (reply.length < 20) {
      throw new HttpError(503, "ai_unavailable", "AI returned an unusable draft. You can write the reply manually.", {
        reason: "invalid_output",
      });
    }
    const checklist = result.data.admin_checklist.map((c) => c.trim()).filter(Boolean).slice(0, 8);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO ai_drafts (ticket_id, body, checklist, model, based_on_message_id, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET body = excluded.body, checklist = excluded.checklist, model = excluded.model,
           based_on_message_id = excluded.based_on_message_id, input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens, created_at = excluded.created_at`,
      )
      .run(
        ticketId,
        reply,
        JSON.stringify(checklist),
        result.model,
        lastAuthorMessage?.id ?? null,
        result.usage.inputTokens,
        result.usage.outputTokens,
        now,
      );
    return { body: reply, checklist, model: result.model, createdAt: now, stale: false };
  }

  private toDraft(ticketId: number, row: DraftRow): AiDraft {
    const latestAuthorMessage = this.db
      .prepare("SELECT MAX(id) AS id FROM ticket_messages WHERE ticket_id = ? AND sender_role = 'author'")
      .get(ticketId) as { id: number | null };
    return {
      body: row.body,
      checklist: JSON.parse(row.checklist) as string[],
      model: row.model,
      createdAt: row.created_at,
      stale: (latestAuthorMessage.id ?? null) !== row.based_on_message_id,
    };
  }
}
