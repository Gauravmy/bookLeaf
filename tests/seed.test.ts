import { describe, expect, it } from "vitest";
import { openDatabase } from "../server/db/connection.js";
import { countRecords, loadSampleData, seedDatabase } from "../server/seed/seed.js";
import { findBook, listBooksForAuthor } from "../server/services/books.js";
import { TEST_PASSWORD } from "./helpers.js";

const data = loadSampleData("data/bookleaf_sample_data.json");

describe("sample data import", () => {
  it("imports exactly 10 authors and 18 books plus demo accounts", async () => {
    const db = openDatabase(":memory:");
    const result = await seedDatabase(db, data, { demoPassword: TEST_PASSWORD, production: false });
    expect(result).toMatchObject({ authors: 10, books: 18, usersCreated: 12 });
    expect(countRecords(db)).toEqual({ authors: 10, books: 18, users: 12 });
  });

  it("is idempotent: re-running creates no duplicates and restores figures", async () => {
    const db = openDatabase(":memory:");
    await seedDatabase(db, data, { demoPassword: TEST_PASSWORD, production: false });
    db.prepare("UPDATE books SET royalty_pending = 1 WHERE id = 'BK001'").run();
    const again = await seedDatabase(db, data, { demoPassword: TEST_PASSWORD, production: false });
    expect(again.usersCreated).toBe(0);
    expect(countRecords(db)).toEqual({ authors: 10, books: 18, users: 12 });
    expect(findBook(db, "BK001")?.royaltyPending).toBe(3570);
  });

  it("preserves IDs, relationships and null values exactly", async () => {
    const db = openDatabase(":memory:");
    await seedDatabase(db, data, { demoPassword: TEST_PASSWORD, production: false });
    expect(listBooksForAuthor(db, "AUTH007").map((b) => b.id).sort()).toEqual(["BK011", "BK012", "BK013"]);
    expect(findBook(db, "BK013")).toMatchObject({
      status: "In Production - Cover Design",
      publicationDate: null,
      mrp: null,
      authorRoyaltyPerCopy: null,
      lastRoyaltyPayoutDate: null,
      printPartner: null,
      availableOn: [],
    });
    expect(findBook(db, "BK017")?.title).toBe("Durga’s Daughters");
    expect(findBook(db, "BK004")).toMatchObject({ totalCopiesSold: 1203, totalRoyaltyEarned: 57744, royaltyPending: 7744 });
  });

  it("refuses to seed without a usable demo password", async () => {
    const db = openDatabase(":memory:");
    await expect(seedDatabase(db, data, { demoPassword: undefined, production: false })).rejects.toThrow(/SEED_DEMO_PASSWORD/);
    await expect(seedDatabase(db, data, { demoPassword: "short", production: false })).rejects.toThrow(/at least 10/);
    await expect(
      seedDatabase(db, data, { demoPassword: "replace-with-a-local-demo-password", production: true }),
    ).rejects.toThrow(/placeholder/);
    expect(countRecords(db).authors).toBe(0);
  });
});
