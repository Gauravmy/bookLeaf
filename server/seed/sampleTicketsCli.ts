import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { createProvider } from "../ai/provider.js";
import { TicketEventBus } from "../realtime/bus.js";
import { AuthorTicketService } from "../services/tickets.js";
import { TriageRunner } from "../services/triage.js";
import { toPublicUser } from "../auth/sessions.js";

/**
 * OPTIONAL demo data: files the brief's seven sample author queries as tickets
 * from sample authors, so the admin queue is not empty in a demo. They are
 * ordinary new tickets (status Open, no replies) and go through the same
 * triage path as real ones. Skips any ticket whose subject already exists.
 *
 * Usage: npm run seed:sample-tickets  (run `npm run seed` first)
 */
const SAMPLES = [
  { email: "ananya.reddy@email.com", bookId: "BK005", subject: "Still no royalty after months", description: "I published my book months ago and still haven't received any royalty. What's going on?" },
  { email: "rohit.kapoor@email.com", bookId: "BK003", subject: "Royalty amount seems too low", description: "My royalty amount seems too low. I sold 200 copies but only received ₹3,000." },
  { email: "priya.sharma@email.com", bookId: "BK001", subject: "Different ISBN on Amazon", description: "My book is showing a different ISBN on Amazon than what's on the physical copy." },
  { email: "diya.chatterjee@email.com", bookId: "BK017", subject: "Author copies print quality", description: "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned." },
  { email: "meera.nair@email.com", bookId: "BK009", subject: "Showing Currently Unavailable on Amazon", description: "My book is published but it's showing as \"Currently Unavailable\" on Amazon." },
  { email: "kavita.deshmukh@email.com", bookId: "BK015", subject: "Still in typesetting", description: "It's been 3 weeks and my book is still in typesetting. When will it be done?" },
  { email: "vikram.joshi@email.com", bookId: "BK006", subject: "Updating my book description", description: "Can I update the description of my book on Amazon after it's already live?" },
];

const config = loadConfig();
const db = openDatabase(config.databasePath);
const bus = new TicketEventBus();
const tickets = new AuthorTicketService(db, bus);
const triage = new TriageRunner(db, createProvider(config.ai), bus);

let created = 0;
for (const sample of SAMPLES) {
  const row = db.prepare("SELECT id, email, name, role, author_id FROM users WHERE email = ?").get(sample.email) as
    | Parameters<typeof toPublicUser>[0]
    | undefined;
  if (!row) {
    console.error(`Account ${sample.email} not found - run \`npm run seed\` first.`);
    process.exitCode = 1;
    break;
  }
  const exists = db.prepare("SELECT 1 FROM tickets WHERE author_id = ? AND subject = ?").get(row.author_id, sample.subject);
  if (exists) continue;
  const id = tickets.create(toPublicUser(row), { bookId: sample.bookId, subject: sample.subject, description: sample.description });
  void triage.schedule(id);
  created++;
}
await triage.idle();
console.log(`Created ${created} sample ticket(s); ${SAMPLES.length - created} already existed.`);
db.close();
