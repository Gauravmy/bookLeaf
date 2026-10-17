import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { countRecords, loadSampleData, seedDatabase } from "./seed.js";

// Usage: npm run seed [-- --reset-passwords]
const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const data = loadSampleData(config.seedDataPath);
  const result = await seedDatabase(db, data, {
    demoPassword: config.seedDemoPassword,
    production: config.env === "production",
    resetPasswords: process.argv.includes("--reset-passwords"),
  });
  console.log(`Imported ${result.authors} authors and ${result.books} books from ${config.seedDataPath}.`);
  console.log(`Accounts created: ${result.usersCreated}, passwords reset: ${result.usersUpdated}.`);
  console.log("Database totals:", countRecords(db));
} catch (err) {
  console.error(`Seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  db.close();
}
