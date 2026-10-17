import type { TicketCategory, TicketPriority } from "../shared/domain.js";

/**
 * Small labelled set for sanity-checking classification. The first seven are
 * the sample queries from the assignment brief; the rest were written for this
 * project to cover varied phrasing and ambiguous cases. It is too small to
 * support strong accuracy claims - it exists to catch regressions and to give
 * an honest rough number.
 */
export interface LabelledTicket {
  source: "brief" | "authored";
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
}

export const LABELLED_TICKETS: LabelledTicket[] = [
  { source: "brief", subject: "No royalty yet", description: "I published my book 4 months ago and still haven't received any royalty. What's going on?", category: "Royalty & Payments", priority: "High" },
  { source: "brief", subject: "Royalty seems too low", description: "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.", category: "Royalty & Payments", priority: "Medium" },
  { source: "brief", subject: "Different ISBN on Amazon", description: "My book is showing a different ISBN on Amazon than what's on the physical copy.", category: "ISBN & Metadata Issues", priority: "High" },
  { source: "brief", subject: "Terrible print quality", description: "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.", category: "Printing & Quality", priority: "High" },
  { source: "brief", subject: "Currently unavailable", description: "My book is published but it's showing as \"Currently Unavailable\" on Amazon.", category: "Distribution & Availability", priority: "High" },
  { source: "brief", subject: "Stuck in typesetting", description: "It's been 3 weeks and my book is still in typesetting. When will it be done?", category: "Book Status & Production Updates", priority: "Medium" },
  { source: "brief", subject: "Update description", description: "Can I update the description of my book on Amazon after it's already live?", category: "ISBN & Metadata Issues", priority: "Low" },

  { source: "authored", subject: "Six months, zero payment", description: "I have not been paid any royalty for 6 months even though my dashboard shows sales. This is unacceptable.", category: "Royalty & Payments", priority: "Critical" },
  { source: "authored", subject: "Bank account change", description: "I changed banks. How do I update the account where my payouts go?", category: "Royalty & Payments", priority: "Low" },
  { source: "authored", subject: "Breakdown request", description: "Could you send me a platform-wise breakdown of how my earnings were calculated last quarter?", category: "Royalty & Payments", priority: "Medium" },
  { source: "authored", subject: "Pending amount not paid", description: "My dashboard shows ₹850 pending but the payout date passed. Why wasn't it transferred?", category: "Royalty & Payments", priority: "Medium" },
  { source: "authored", subject: "Duplicate ISBN", description: "Two of my books seem to have the same ISBN printed on the back cover.", category: "ISBN & Metadata Issues", priority: "High" },
  { source: "authored", subject: "Wrong author name", description: "Flipkart lists the author name as 'Rohit Kapur' instead of 'Rohit Kapoor'.", category: "ISBN & Metadata Issues", priority: "Medium" },
  { source: "authored", subject: "Own imprint", description: "I want my next book to carry an ISBN under my own imprint. Is that possible with BookLeaf?", category: "ISBN & Metadata Issues", priority: "Low" },
  { source: "authored", subject: "Binding falling apart", description: "The binding on the copies I ordered is coming loose after one read. Pages are falling out.", category: "Printing & Quality", priority: "High" },
  { source: "authored", subject: "Cover colours off", description: "The cover colour on printed copies looks much darker than the approved proof.", category: "Printing & Quality", priority: "Medium" },
  { source: "authored", subject: "Bulk order turnaround", description: "If I order 50 author copies today, how long will printing take?", category: "Printing & Quality", priority: "Low" },
  { source: "authored", subject: "Not on Flipkart", description: "My book went live two weeks ago but I can't find it on Flipkart at all.", category: "Distribution & Availability", priority: "Medium" },
  { source: "authored", subject: "Amazon UK", description: "Is my book available to readers in the UK? A friend there could not buy it.", category: "Distribution & Availability", priority: "Medium" },
  { source: "authored", subject: "Out of stock during launch", description: "We are doing a launch event this weekend and the book shows out of stock on every site. Urgent!", category: "Distribution & Availability", priority: "Critical" },
  { source: "authored", subject: "Cover approval", description: "I sent my feedback on the cover design last week. What happens next?", category: "Book Status & Production Updates", priority: "Medium" },
  { source: "authored", subject: "Publication date", description: "My manuscript was received in August. When can I expect the book to be published?", category: "Book Status & Production Updates", priority: "Medium" },
  { source: "authored", subject: "Proofreading rounds", description: "How many proofreading revision rounds are included before printing?", category: "Book Status & Production Updates", priority: "Low" },
  { source: "authored", subject: "Author bio", description: "Can I update my author bio and photo?", category: "General Inquiry", priority: "Low" },
  { source: "authored", subject: "Package upgrade", description: "What extra do I get with the Bestseller Breakthrough package compared to Standard Free?", category: "General Inquiry", priority: "Low" },
  { source: "authored", subject: "Account access", description: "Someone changed my account email without my permission. Please lock my account.", category: "General Inquiry", priority: "Critical" },
  { source: "authored", subject: "Contact person", description: "Is there a dedicated account manager I can call?", category: "General Inquiry", priority: "Low" },
];
