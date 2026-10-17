import type { DB } from "../db/connection.js";
import { nowIso } from "../db/connection.js";
import type { TicketCategory, TicketPriority, TriageSource } from "../../shared/domain.js";
import type { TicketEventBus } from "../realtime/bus.js";
import { describeAiFailure, type LlmProvider } from "../ai/provider.js";
import {
  ClassificationSchema,
  PrioritySchema,
  buildClassificationPrompt,
  buildPriorityPrompt,
  type TicketPromptInput,
} from "../ai/prompts.js";
import { classifyByRules, prioritiseByRules } from "../ai/rules.js";
import { bookSummary, findBook } from "./books.js";
import { getTicketRow, recordEvent } from "./tickets.js";

export interface TriageOutcome {
  category: TicketCategory;
  categorySource: Extract<TriageSource, "ai" | "rules">;
  priority: TicketPriority;
  prioritySource: Extract<TriageSource, "ai" | "rules">;
  rationale: string;
  error: string | null;
}

/**
 * Classifies and prioritises one ticket. Each step uses the LLM first and falls
 * back to keyword rules independently, so a failed priority call still keeps a
 * good AI category. Never throws for AI failures.
 */
export async function triage(provider: LlmProvider, input: TicketPromptInput): Promise<TriageOutcome> {
  const errors: string[] = [];

  let category: TicketCategory;
  let categorySource: "ai" | "rules";
  let categoryWhy: string;
  try {
    const prompt = buildClassificationPrompt(input);
    const { data } = await provider.generate({
      operation: "classify",
      ...prompt,
      schema: ClassificationSchema,
      maxTokens: 1024,
      effort: "low",
    });
    ({ category } = data);
    categorySource = "ai";
    categoryWhy = data.rationale;
  } catch (err) {
    errors.push(describeAiFailure(err));
    const rules = classifyByRules(input);
    ({ category } = rules);
    categorySource = "rules";
    categoryWhy = rules.rationale;
  }

  let priority: TicketPriority;
  let prioritySource: "ai" | "rules";
  let priorityWhy: string;
  // If classification already failed for a provider-level reason, skip the
  // second call instead of paying for another timeout.
  if (categorySource === "rules") {
    const rules = prioritiseByRules(input, category);
    ({ priority } = rules);
    prioritySource = "rules";
    priorityWhy = rules.rationale;
  } else {
    try {
      const prompt = buildPriorityPrompt(input, category);
      const { data } = await provider.generate({
        operation: "prioritise",
        ...prompt,
        schema: PrioritySchema,
        maxTokens: 1024,
        effort: "low",
      });
      ({ priority } = data);
      prioritySource = "ai";
      priorityWhy = data.rationale;
    } catch (err) {
      errors.push(describeAiFailure(err));
      const rules = prioritiseByRules(input, category);
      ({ priority } = rules);
      prioritySource = "rules";
      priorityWhy = rules.rationale;
    }
  }

  return {
    category,
    categorySource,
    priority,
    prioritySource,
    rationale: `Category: ${categoryWhy}\nPriority: ${priorityWhy}`,
    error: errors.length ? [...new Set(errors)].join("; ") : null,
  };
}

/**
 * Runs triage in the background after a ticket is created, so ticket creation
 * never waits on (or fails because of) the AI provider.
 */
export class TriageRunner {
  private inFlight = new Map<number, Promise<void>>();

  constructor(
    private readonly db: DB,
    private readonly provider: LlmProvider,
    private readonly bus: TicketEventBus,
  ) {}

  /** Fire-and-forget; duplicate requests for the same ticket share one run. */
  schedule(ticketId: number, options: { force?: boolean } = {}): Promise<void> {
    const existing = this.inFlight.get(ticketId);
    if (existing) return existing;
    const run = this.run(ticketId, options.force ?? false)
      .catch((err) => console.error(`[triage] ticket ${ticketId} failed`, err))
      .finally(() => this.inFlight.delete(ticketId));
    this.inFlight.set(ticketId, run);
    return run;
  }

  /** Test helper: resolves once all scheduled triage has finished. */
  async idle() {
    await Promise.all([...this.inFlight.values()]);
  }

  private async run(ticketId: number, force: boolean) {
    const ticket = getTicketRow(this.db, ticketId);
    if (!ticket) return;
    const book = ticket.book_id ? findBook(this.db, ticket.book_id) : null;
    const outcome = await triage(this.provider, {
      subject: ticket.subject,
      description: ticket.description,
      bookSummary: bookSummary(book),
    });

    // Admin overrides always win - including ones made while the AI call was running.
    const result = this.db
      .prepare(
        `UPDATE tickets SET
           category = CASE WHEN category_source = 'admin' THEN category ELSE @category END,
           category_source = CASE WHEN category_source = 'admin' THEN 'admin' ELSE @categorySource END,
           priority = CASE WHEN priority_source = 'admin' THEN priority ELSE @priority END,
           priority_source = CASE WHEN priority_source = 'admin' THEN 'admin' ELSE @prioritySource END,
           triage_rationale = @rationale, triage_error = @error, updated_at = @now
         WHERE id = @id AND (@force = 1 OR category_source = 'pending' OR priority_source = 'pending')`,
      )
      .run({ ...outcome, now: nowIso(), id: ticketId, force: force ? 1 : 0 });
    if (result.changes === 0) return;

    const how = outcome.categorySource === "ai" ? "AI" : "rule-based fallback";
    recordEvent(
      this.db,
      ticketId,
      null,
      "triage",
      `Auto-triage (${how}): ${outcome.category}, ${outcome.priority}${outcome.error ? ` - AI issue: ${outcome.error}` : ""}`,
    );
    this.bus.publish({ ticketId, authorId: ticket.author_id, kind: "triaged" });
  }
}
