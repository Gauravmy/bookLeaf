import request from "supertest";
import type { z } from "zod";
import { loadConfig } from "../server/config.js";
import { openDatabase } from "../server/db/connection.js";
import { createApp } from "../server/app.js";
import { AiError, type LlmProvider, type StructuredRequest, type StructuredResult } from "../server/ai/provider.js";
import { loadSampleData, seedDatabase } from "../server/seed/seed.js";

export const TEST_PASSWORD = "test-password-123";

/** Records every request and answers via a per-operation handler, so tests can inspect prompts. */
export class FakeProvider implements LlmProvider {
  readonly model = "fake-model";
  calls: StructuredRequest<z.ZodType>[] = [];
  constructor(public handler: (req: StructuredRequest<z.ZodType>) => unknown) {}

  async generate<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
    this.calls.push(req);
    const raw = await this.handler(req);
    // Mirror the real provider: validate output against the schema.
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new AiError("invalid_output", "Model output did not match the expected schema");
    return { data: parsed.data, model: this.model, usage: { inputTokens: 100, outputTokens: 50 } };
  }

  callsFor(operation: string) {
    return this.calls.filter((c) => c.operation === operation);
  }
}

export const failingProvider = (kind: ConstructorParameters<typeof AiError>[0] = "timeout") =>
  new FakeProvider(() => {
    throw new AiError(kind, `simulated ${kind}`);
  });

export async function createTestApp(provider: LlmProvider, clock?: () => Date) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", SEED_DEMO_PASSWORD: TEST_PASSWORD });
  const db = openDatabase(":memory:");
  await seedDatabase(db, loadSampleData(config.seedDataPath), { demoPassword: TEST_PASSWORD, production: false });
  const { app, triage, bus } = createApp({ config, db, provider, clock });
  return { app, db, triage, bus, config };
}

export async function loginAs(app: Parameters<typeof request.agent>[0], email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export const AUTHORS = {
  priya: "priya.sharma@email.com", // AUTH001: BK001, BK002
  ananya: "ananya.reddy@email.com", // AUTH003: BK005, never paid
  sneha: "sneha.kulkarni@email.com", // AUTH007: BK011-BK013 (BK013 in production)
  kavita: "kavita.deshmukh@email.com", // AUTH009: BK015 in production, BK016 pending ₹850
};
export const ADMIN = "admin@bookleaf.test";
export const ADMIN_2 = "ops@bookleaf.test";

export const sampleTicket = {
  bookId: "BK001",
  subject: "Royalty not received yet",
  description: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
};
