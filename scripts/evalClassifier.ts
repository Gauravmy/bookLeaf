import { loadConfig } from "../server/config.js";
import { AnthropicProvider, createProvider } from "../server/ai/provider.js";
import { triage } from "../server/services/triage.js";
import { classifyByRules, prioritiseByRules } from "../server/ai/rules.js";
import { LABELLED_TICKETS } from "./labelledTickets.js";

/**
 * Measures category and priority agreement on the small labelled set.
 * Always evaluates the rule-based fallback; evaluates the LLM too when
 * ANTHROPIC_API_KEY is set (about 2 small calls per ticket, ~54 calls in total).
 */
const config = loadConfig();
const provider = createProvider(config.ai);

type Score = { category: number; priority: number };
const pct = (n: number) => `${((n / LABELLED_TICKETS.length) * 100).toFixed(0)}%`;

const rules: Score = { category: 0, priority: 0 };
const misses: string[] = [];
for (const t of LABELLED_TICKETS) {
  const input = { subject: t.subject, description: t.description, bookSummary: null };
  const c = classifyByRules(input).category;
  const p = prioritiseByRules(input, c).priority;
  if (c === t.category) rules.category++;
  else misses.push(`  rules: "${t.subject}" -> ${c} (expected ${t.category})`);
  if (p === t.priority) rules.priority++;
}
console.log(`Labelled tickets: ${LABELLED_TICKETS.length} (7 from the brief, ${LABELLED_TICKETS.length - 7} self-authored)`);
console.log(`Rule-based fallback  category ${pct(rules.category)}  priority ${pct(rules.priority)}`);

if (provider instanceof AnthropicProvider) {
  const llm: Score = { category: 0, priority: 0 };
  let failures = 0;
  for (const t of LABELLED_TICKETS) {
    const out = await triage(provider, { subject: t.subject, description: t.description, bookSummary: null });
    if (out.categorySource !== "ai") failures++;
    if (out.category === t.category) llm.category++;
    else misses.push(`  llm:   "${t.subject}" -> ${out.category} (expected ${t.category})`);
    if (out.priority === t.priority) llm.priority++;
  }
  console.log(`LLM (${provider.model})  category ${pct(llm.category)}  priority ${pct(llm.priority)}  fallbacks used: ${failures}`);
} else {
  console.log("LLM evaluation skipped: no ANTHROPIC_API_KEY configured.");
}
if (misses.length) console.log(`Misclassifications:\n${misses.join("\n")}`);
