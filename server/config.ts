import { z } from "zod";

// All runtime configuration comes from environment variables. Secrets (API keys,
// session secret) are never given defaults that would work in production.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_PATH: z.string().default("bookleaf.db"),
  SEED_DATA_PATH: z.string().default("data/bookleaf_sample_data.json"),
  /** Comma-separated list of browser origins allowed to call the API (CORS + CSRF origin check). */
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4000"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  /** Set to "true" when served behind HTTPS (Render/Railway); marks the session cookie Secure. */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-haiku-5-5"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AI_ENABLED: z.enum(["true", "false"]).default("true"),
  SEED_ON_START: z.enum(["true", "false"]).default("false"),
  SEED_DEMO_PASSWORD: z.string().optional(),
});

export type AppConfig = {
  env: "development" | "production" | "test";
  port: number;
  databasePath: string;
  seedDataPath: string;
  allowedOrigins: string[];
  sessionTtlHours: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  ai: { apiKey: string | undefined; model: string; timeoutMs: number; enabled: boolean };
  seedOnStart: boolean;
  seedDemoPassword: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    seedDataPath: e.SEED_DATA_PATH,
    allowedOrigins: e.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    trustProxy: e.TRUST_PROXY === "true",
    ai: {
      apiKey: e.ANTHROPIC_API_KEY || undefined,
      model: e.AI_MODEL,
      timeoutMs: e.AI_TIMEOUT_MS,
      enabled: e.AI_ENABLED === "true",
    },
    seedOnStart: e.SEED_ON_START === "true",
    seedDemoPassword: e.SEED_DEMO_PASSWORD || undefined,
  };
}
