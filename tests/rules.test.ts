import { describe, expect, it } from "vitest";
import { classifyByRules, prioritiseByRules } from "../server/ai/rules.js";
import { nextPayoutSchedule, summariseRoyalties } from "../server/ai/accountFacts.js";
import { LABELLED_TICKETS } from "../scripts/labelledTickets.js";

const input = (subject: string, description: string) => ({ subject, description, bookSummary: null });

describe("rule-based fallback", () => {
  // The brief's own sample queries must route correctly even without the LLM.
  it.each([
    ["Royalty question", "I published my book 4 months ago and still haven't received any royalty. What's going on?", "Royalty & Payments"],
    ["Royalty too low", "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.", "Royalty & Payments"],
    ["ISBN mismatch", "My book is showing a different ISBN on Amazon than what's on the physical copy.", "ISBN & Metadata Issues"],
    ["Print quality", "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.", "Printing & Quality"],
    ["Unavailable", "My book is published but it's showing as \"Currently Unavailable\" on Amazon.", "Distribution & Availability"],
    ["Typesetting", "It's been 3 weeks and my book is still in typesetting. When will it be done?", "Book Status & Production Updates"],
    ["Hello", "Who should I talk to about joining your newsletter?", "General Inquiry"],
  ])("classifies %s", (subject, description, expected) => {
    expect(classifyByRules(input(subject, description)).category).toBe(expected);
  });

  it("ranks long-unpaid royalties above a bio update", () => {
    const unpaid = input("No royalty", "I haven't received any royalty for 6 months.");
    const bio = input("Author bio", "Can I update my author bio?");
    expect(prioritiseByRules(unpaid, "Royalty & Payments").priority).toBe("Critical");
    expect(prioritiseByRules(bio, "General Inquiry").priority).toBe("Low");
  });

  it("keeps ISBN issues High (policy) without keyword-escalating them to Critical", () => {
    const question = input("ISBN?", "Is it possible that my ISBN is duplicated?");
    const mismatch = input("Different ISBN on Amazon", "My book is showing a different ISBN on Amazon than what's on the physical copy.");
    expect(prioritiseByRules(question, "ISBN & Metadata Issues").priority).toBe("High");
    expect(prioritiseByRules(mismatch, "ISBN & Metadata Issues").priority).toBe("High");
  });

  it("treats non-ISBN metadata changes as routine", () => {
    const q = input("Updating my book description", "Can I update the description of my book on Amazon after it's already live?");
    expect(prioritiseByRules(q, "ISBN & Metadata Issues").priority).toBe("Low");
  });

  it("reaches a reasonable accuracy on the labelled set (documented, not tuned to 100%)", () => {
    const correct = LABELLED_TICKETS.filter((t) => classifyByRules(input(t.subject, t.description)).category === t.category).length;
    expect(correct / LABELLED_TICKETS.length).toBeGreaterThanOrEqual(0.7);
  });
});

describe("royalty schedule facts", () => {
  it("uses the last quarter's 45-day deadline while it is still ahead", () => {
    expect(nextPayoutSchedule(new Date("2026-10-17T00:00:00Z"))).toEqual({ quarterLabel: "Q3 2026", quarterEnd: "2026-09-30", payoutDueBy: "2026-11-14" });
  });

  it("moves to the current quarter once that deadline has passed, across year ends", () => {
    expect(nextPayoutSchedule(new Date("2026-12-01T00:00:00Z"))).toEqual({ quarterLabel: "Q4 2026", quarterEnd: "2026-12-31", payoutDueBy: "2027-02-14" });
    expect(nextPayoutSchedule(new Date("2027-01-10T00:00:00Z")).quarterLabel).toBe("Q4 2026");
  });

  it("summarises pending royalty and never-paid books", () => {
    const base = { totalRoyaltyEarned: 0, royaltyPending: 0, lastRoyaltyPayoutDate: null };
    const books = [
      { ...base, totalRoyaltyEarned: 850, royaltyPending: 850 },
      { ...base, totalRoyaltyEarned: 0 },
    ] as Parameters<typeof summariseRoyalties>[0];
    expect(summariseRoyalties(books)).toEqual({ totalPending: 850, booksWithNoPayout: 1 });
  });
});
