import type { TicketCategory, TicketPriority } from "../../shared/domain.js";
import type { TicketPromptInput } from "./prompts.js";

/**
 * Deterministic keyword fallback used when the LLM is unavailable. It is a
 * safety net, not a substitute: results are labelled "rules" in the admin UI
 * so agents know to double-check them. Accuracy on our small labelled set is
 * reported by `npm run eval:classifier`.
 */

const CATEGORY_KEYWORDS: Record<Exclude<TicketCategory, "General Inquiry">, RegExp[]> = {
  "Royalty & Payments": [
    /royalt/i, /payout/i, /\bpaid\b/i, /payment/i, /bank (account|details|transfer)/i, /\bearning/i, /₹|\brs\.?\s?\d|\binr\b/i,
    /statement/i, /commission/i,
  ],
  "ISBN & Metadata Issues": [/\bisbn/i, /metadata/i, /wrong (author|title|book)/i, /\bdescription\b/i, /\bblurb\b/i, /author name/i, /\bprice\b.*(listing|amazon)/i],
  "Printing & Quality": [/print(ing|ed)? (quality|issue|defect)/i, /misprint/i, /binding/i, /blurry|blurred/i, /misaligned/i, /\bpages?\b.*(missing|torn|upside)/i, /colou?r (issue|inconsisten)/i, /author cop(y|ies)/i, /defect/i, /reprint/i],
  "Distribution & Availability": [/unavailable/i, /out of stock/i, /not (showing|listed|available|visible)/i, /\blisting\b/i, /amazon|flipkart|bookleaf store/i, /\bsync/i, /can'?t (find|buy)/i],
  "Book Status & Production Updates": [/typesetting/i, /cover design/i, /proofread/i, /\bproofs?\b/i, /editing/i, /production/i, /\bstatus\b/i, /when will.*(publish|live|done|ready)/i, /\bdelay/i, /manuscript/i],
};

// Ties are broken by this order, which favours the more specific/urgent categories.
const TIE_BREAK: TicketCategory[] = [
  "ISBN & Metadata Issues",
  "Printing & Quality",
  "Royalty & Payments",
  "Distribution & Availability",
  "Book Status & Production Updates",
];

export function classifyByRules(ticket: TicketPromptInput): { category: TicketCategory; rationale: string } {
  const text = `${ticket.subject}\n${ticket.description}`;
  let best: { category: TicketCategory; score: number; hits: string[] } = { category: "General Inquiry", score: 0, hits: [] };
  for (const category of TIE_BREAK) {
    const patterns = CATEGORY_KEYWORDS[category as keyof typeof CATEGORY_KEYWORDS];
    const hits = patterns.map((p) => text.match(p)?.[0]).filter((m): m is string => Boolean(m));
    // Subject matches count double: authors usually state the topic there.
    const score = hits.length + patterns.filter((p) => p.test(ticket.subject)).length;
    if (score > best.score) best = { category, score, hits };
  }
  const rationale =
    best.score === 0
      ? "Rule-based fallback: no category keywords matched."
      : `Rule-based fallback: matched ${best.hits.slice(0, 4).map((h) => `"${h.toLowerCase()}"`).join(", ")}.`;
  return { category: best.category, rationale };
}

const BASE_PRIORITY: Record<TicketCategory, TicketPriority> = {
  "ISBN & Metadata Issues": "High",
  "Printing & Quality": "High",
  "Royalty & Payments": "Medium",
  "Distribution & Availability": "Medium",
  "Book Status & Production Updates": "Medium",
  "General Inquiry": "Low",
};

const CRITICAL_SIGNALS = [/legal|lawyer|court|fraud|scam/i, /hack(ed)?|compromis|unauthori[sz]ed/i, /(no|not|never|n't).{0,40}royalt.{0,40}(\d+|six|several|many) (months|quarters)/i, /(\d+|six|several|many) (months|quarters).{0,40}(no|not|never|without).{0,30}(royalt|pay)/i];
const ESCALATE_SIGNALS = [/urgent|asap|immediately/i, /(still|haven'?t|have not|never) (been )?(received|paid|heard)/i, /overdue|weeks? (ago|now)|months? (ago|now)/i, /wrong|duplicate|mismatch|different isbn/i, /unavailable|out of stock/i];
const ROUTINE_SIGNALS = [/^(how|can|could|is it possible|what)\b/i, /update (my )?(author )?(bio|description|photo)/i, /\bquestion\b/i];

const ORDER: TicketPriority[] = ["Low", "Medium", "High", "Critical"];
const bump = (p: TicketPriority, by: number) => ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(p) + by))]!;

export function prioritiseByRules(ticket: TicketPromptInput, category: TicketCategory): { priority: TicketPriority; rationale: string } {
  const text = `${ticket.subject}
${ticket.description}`;
  if (CRITICAL_SIGNALS.some((p) => p.test(text))) {
    return { priority: "Critical", rationale: "Rule-based fallback: legal, security or long-unpaid royalty signal." };
  }
  // Policy: ISBN errors are always high priority. Other metadata requests
  // (descriptions, author names) start at Medium.
  const isIsbnIssue = /\bisbn/i.test(text);
  let priority = category === "ISBN & Metadata Issues" && !isIsbnIssue ? "Medium" : BASE_PRIORITY[category];
  const reasons = [`${category} baseline ${priority}`];
  if (ESCALATE_SIGNALS.some((p) => p.test(text))) {
    // Keywords alone never make a ticket Critical; that needs a critical signal above.
    priority = ORDER.indexOf(priority) < ORDER.indexOf("High") ? bump(priority, 1) : priority;
    reasons.push("escalation keywords");
  } else if (!isIsbnIssue && ROUTINE_SIGNALS.some((p) => p.test(ticket.subject.trim()) || p.test(ticket.description.trim()))) {
    priority = bump(priority, -1);
    reasons.push("routine question phrasing");
  }
  return { priority, rationale: `Rule-based fallback: ${reasons.join(", ")}.` };
}
