import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/** Why an AI call failed. Every kind is recoverable: callers fall back to rules or manual work. */
export type AiFailureKind =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "auth"
  | "invalid_output"
  | "refused";

export class AiError extends Error {
  constructor(
    public readonly kind: AiFailureKind,
    message: string,
  ) {
    super(message);
  }
}

export interface StructuredRequest<T extends z.ZodType> {
  /** Short operation name used in logs, e.g. "classify". */
  operation: string;
  system: string;
  user: string;
  schema: T;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** The only surface the rest of the app depends on, so providers can be swapped or faked in tests. */
export interface LlmProvider {
  readonly model: string;
  generate<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>>;
}

/** Used when no API key is configured or AI is switched off; every call fails fast with a clear reason. */
export class DisabledProvider implements LlmProvider {
  constructor(
    public readonly model: string,
    private readonly reason: string,
  ) {}
  async generate<T extends z.ZodType>(): Promise<StructuredResult<z.infer<T>>> {
    throw new AiError("not_configured", this.reason);
  }
}

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    public readonly model: string,
    timeoutMs: number,
  ) {
    // One SDK retry covers transient 429/5xx/connection errors; anything longer
    // would keep an admin waiting, and triage has a rule-based fallback anyway.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async generate<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
    const started = Date.now();
    let response;
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      });
    } catch (err) {
      throw toAiError(err);
    }

    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    // Log usage for cost tracking; never log prompt content, ticket text or keys.
    console.info(
      `[ai] op=${req.operation} model=${this.model} in=${usage.inputTokens} out=${usage.outputTokens} ms=${Date.now() - started} stop=${response.stop_reason}`,
    );

    if (response.stop_reason === "refusal") throw new AiError("refused", "The model declined to answer");
    if (response.stop_reason === "max_tokens") throw new AiError("invalid_output", "Model output was truncated");

    // Structured outputs constrain the format, but we still validate against the
    // schema ourselves before anything reaches the database.
    const checked = req.schema.safeParse(response.parsed_output);
    if (!checked.success) throw new AiError("invalid_output", "Model output did not match the expected schema");
    return { data: checked.data, model: this.model, usage };
  }
}

function toAiError(err: unknown): AiError {
  // Most specific first: APIConnectionTimeoutError extends APIConnectionError, which extends APIError.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "The AI provider timed out");
  if (err instanceof Anthropic.APIConnectionError) return new AiError("unavailable", "Could not reach the AI provider");
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limited", "The AI provider is rate limiting requests");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("auth", "The AI provider rejected the configured credentials");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError("unavailable", `The AI provider returned an error (status ${err.status ?? "unknown"})`);
  }
  if (err instanceof Error && /parse|json/i.test(err.name + err.message)) {
    return new AiError("invalid_output", "Model output could not be parsed");
  }
  return new AiError("unavailable", "Unexpected AI provider failure");
}

export function createProvider(config: { apiKey?: string; model: string; timeoutMs: number; enabled: boolean }): LlmProvider {
  if (!config.enabled) return new DisabledProvider(config.model, "AI features are disabled (AI_ENABLED=false)");
  if (!config.apiKey) return new DisabledProvider(config.model, "No AI provider key is configured (ANTHROPIC_API_KEY)");
  return new AnthropicProvider(config.apiKey, config.model, config.timeoutMs);
}

/** Human-readable explanation for admins; deliberately free of provider internals. */
export function describeAiFailure(err: unknown): string {
  if (err instanceof AiError) return err.message;
  return "Unexpected AI failure";
}
