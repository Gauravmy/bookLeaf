import type { TicketCategory } from "../../shared/domain.js";

/**
 * The BookLeaf Knowledge Base from the assignment brief, split into sections so
 * each AI call only receives the policy text relevant to the ticket's category
 * (see sectionsForCategory). The wording is kept close to the source document;
 * these are company policies, not records of actions taken for any author.
 */
export interface KbSection {
  id: string;
  title: string;
  text: string;
}

export const KB: Record<string, KbSection> = {
  company: {
    id: "company",
    title: "Company overview",
    text: [
      "BookLeaf Publishing is a self-publishing company operating in India and the US.",
      "Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid, with marketing and distribution add-ons).",
      "BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution, and royalty management.",
      "In-house printing facility and warehouse in Delhi; print partners include Repro India and Epitome Books.",
    ].join("\n"),
  },
  royalty: {
    id: "royalty",
    title: "Royalty policy",
    text: [
      "80/20 royalty split: 80% of the net profit per book goes to the author, 20% to BookLeaf.",
      "Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart), and shipping charges.",
      "Royalties are calculated quarterly and paid within 45 days of the quarter ending.",
      "Minimum payout threshold: ₹1,000. Accumulated royalties below this roll over to the next quarter.",
      "Payouts are made via bank transfer to the account linked in the author's dashboard.",
      "Authors can view a detailed royalty breakdown in their dashboard, showing sales figures per platform.",
    ].join("\n"),
  },
  isbn: {
    id: "isbn",
    title: "ISBN policy",
    text: [
      "Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf.",
      "ISBNs are registered under BookLeaf's publisher imprint. An author who wants an ISBN under their own imprint must obtain it independently.",
      "An ISBN error (duplicate, wrong book linked) is treated as a high-priority issue and escalated to the production team.",
    ].join("\n"),
  },
  printing: {
    id: "printing",
    title: "Printing & quality",
    text: [
      "In-house printing handles most orders. Overflow or specific format requirements go to Repro India or Epitome Books.",
      "Standard print turnaround: 5-7 business days from order confirmation.",
      "For a quality issue (misprints, binding defects, color inconsistency), BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.",
    ].join("\n"),
  },
  distribution: {
    id: "distribution",
    title: "Distribution & availability",
    text: [
      "Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK, and the BookLeaf Store.",
      "New listings typically go live within 7-10 business days after publication is complete.",
      "A book showing as unavailable on a platform usually indicates a stock sync issue; BookLeaf's team can trigger a re-sync within 24-48 hours.",
    ].join("\n"),
  },
  production: {
    id: "production",
    title: "Production stages",
    text: [
      "Stages: Manuscript Received -> Editing (if opted) -> Cover Design -> Typesetting -> Proofreading -> ISBN Assignment -> Printing -> Distribution Setup -> Published & Live.",
      "Authors are updated at each stage via email.",
      "Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).",
    ].join("\n"),
  },
  metadata: {
    id: "metadata",
    title: "Metadata updates",
    text: "Metadata updates (e.g. book description) can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3-5 business days.",
  },
};

export const TONE_GUIDELINES = [
  "Always empathetic and professional. Authors are partners, not customers to be managed.",
  "Acknowledge the author's concern before jumping to solutions.",
  "Be specific: include actual numbers, dates, and statuses wherever possible rather than vague reassurances.",
  "If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.",
  "If the issue requires escalation or investigation, give a clear timeline (e.g. 'Our team will look into this and get back to you within 48 hours') rather than open-ended promises.",
  "Always end with a clear next step for the author and/or the BookLeaf team.",
].join("\n");

/** Calibration guidance from the brief's sample query -> response table, one or two per category. */
export const RESPONSE_GUIDANCE: Record<TicketCategory, string> = {
  "Royalty & Payments": [
    "Missing royalty: acknowledge the frustration, explain the quarterly cycle and 45-day payout window, ask the author to confirm bank details are linked, state the next payout date per the schedule. If genuinely overdue, escalate with a 48-hour resolution timeline.",
    "Royalty seems low: explain net profit (MRP minus printing, platform commission, shipping), offer a detailed line-by-line breakdown. Be transparent, not defensive.",
  ].join("\n"),
  "ISBN & Metadata Issues": [
    "ISBN mismatch: treat as high priority, acknowledge it is a serious data issue, confirm escalation to the production team, give a 48-hour resolution timeline.",
    "Metadata/description change on a live book: yes, submit via the dashboard or by email; changes reflect within 3-5 business days.",
  ].join("\n"),
  "Printing & Quality":
    "Print defects: apologise sincerely, ask for photos of the defective copies, confirm a free reprint once verified, reprint timeline 5-7 business days.",
  "Distribution & Availability":
    "Showing unavailable: explain this is typically a stock sync issue, state that a re-sync with the distribution team is being requested, set the expectation of 24-48 hours.",
  "Book Status & Production Updates":
    "Production delay: use the book's actual production status from the account facts. Be honest about likely causes (e.g. waiting on proof approval), give a specific updated timeline only if it can be supported, and frame any author-side delay collaboratively without blame.",
  "General Inquiry":
    "Answer the question directly using the relevant policy; if the policy does not cover it, say the team will confirm and give a clear next step.",
};

const CATEGORY_SECTIONS: Record<TicketCategory, string[]> = {
  "Royalty & Payments": ["royalty"],
  "ISBN & Metadata Issues": ["isbn", "metadata"],
  "Printing & Quality": ["printing"],
  "Distribution & Availability": ["distribution"],
  "Book Status & Production Updates": ["production", "distribution"],
  // General questions can touch anything; send the compact overview plus the
  // most commonly asked-about policies instead of the whole knowledge base.
  "General Inquiry": ["company", "metadata", "distribution"],
};

/** Minimal policy context for one category - the main token-saving lever for drafting. */
export function sectionsForCategory(category: TicketCategory): KbSection[] {
  return CATEGORY_SECTIONS[category].map((id) => KB[id]!).filter(Boolean);
}
