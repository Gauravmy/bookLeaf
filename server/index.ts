import path from "node:path";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { AnthropicProvider, createProvider } from "./ai/provider.js";
import { createApp } from "./app.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { countRecords, loadSampleData, seedDatabase } from "./seed/seed.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);

// Hosts with ephemeral disks (e.g. Render's free tier) start with an empty
// database; SEED_ON_START runs the idempotent seed on every boot.
if (config.seedOnStart) {
  const result = await seedDatabase(db, loadSampleData(config.seedDataPath), {
    demoPassword: config.seedDemoPassword,
    production: config.env === "production",
  });
  console.log(`[seed] ${result.authors} authors, ${result.books} books, ${result.usersCreated} new accounts`);
}
if (countRecords(db).authors === 0) {
  console.warn("[startup] Database is empty. Run `npm run seed` to import the sample data.");
}

const provider = createProvider(config.ai);
const { app } = createApp({ config, db, provider, webDir: path.resolve("dist/web") });

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60_000).unref();

app.listen(config.port, () => {
  console.log(`BookLeaf support portal listening on http://localhost:${config.port}`);
  console.log(
    provider instanceof AnthropicProvider
      ? `AI enabled (${provider.model})`
      : "AI disabled - rule-based triage and manual replies only",
  );
});
