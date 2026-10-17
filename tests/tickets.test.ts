import { describe, expect, it } from "vitest";
import { ADMIN, ADMIN_2, AUTHORS, createTestApp, failingProvider, loginAs, sampleTicket } from "./helpers.js";

describe("ticket lifecycle", () => {
  it("runs create -> triage -> override -> assign -> reply -> author follow-up -> resolve", async () => {
    const { app, triage } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const admin = await loginAs(app, ADMIN);

    const created = await priya.post("/api/author/tickets").send(sampleTicket);
    expect(created.status).toBe(201);
    expect(created.body.ticket).toMatchObject({ status: "Open", bookTitle: "Whispers of the Ganges", messages: [] });
    const id = created.body.ticket.id;
    await triage.idle();

    // Admin queue shows the ticket with fallback triage clearly labelled.
    const queue = await admin.get("/api/admin/tickets");
    expect(queue.body.total).toBe(1);
    expect(queue.body.items[0]).toMatchObject({ id, authorName: "Priya Sharma", category: "Royalty & Payments", categorySource: "rules" });

    // Override classification and priority, assign to self.
    const me = (await admin.get("/api/auth/me")).body.user;
    const patched = await admin
      .patch(`/api/admin/tickets/${id}`)
      .send({ category: "General Inquiry", priority: "Low", assigneeId: me.id, status: "In Progress" });
    expect(patched.status).toBe(200);
    expect(patched.body.ticket).toMatchObject({
      category: "General Inquiry",
      categorySource: "admin",
      priority: "Low",
      prioritySource: "admin",
      assigneeName: "Support Admin",
      status: "In Progress",
    });
    expect(patched.body.ticket.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(["created", "triage", "category", "priority", "assignment", "status"]),
    );

    // Reply appears for the author.
    await admin.post(`/api/admin/tickets/${id}/messages`).send({ body: "Hi Priya, we are looking into this.", status: "Resolved" });
    let authorView = (await priya.get(`/api/author/tickets/${id}`)).body.ticket;
    expect(authorView.status).toBe("Resolved");
    expect(authorView.messages).toHaveLength(1);
    expect(authorView.messages[0]).toMatchObject({ senderRole: "admin", senderName: "Support Admin" });
    expect(authorView.category).toBe("General Inquiry");

    // Author follow-up reopens a resolved ticket.
    await priya.post(`/api/author/tickets/${id}/messages`).send({ body: "Thanks, but I still have a question." });
    authorView = (await priya.get(`/api/author/tickets/${id}`)).body.ticket;
    expect(authorView.status).toBe("Open");
    expect(authorView.messages).toHaveLength(2);

    // Closed tickets accept no further author messages.
    await admin.patch(`/api/admin/tickets/${id}`).send({ status: "Closed" });
    expect((await priya.post(`/api/author/tickets/${id}/messages`).send({ body: "one more" })).status).toBe(409);
  });

  it("creates account-level tickets without a book", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const res = await priya.post("/api/author/tickets").send({ bookId: "", subject: "Update my author bio", description: "Can I update my author bio on my profile page please?" });
    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatchObject({ bookId: null, bookTitle: null });
  });

  it("validates ticket input with field-level messages", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const res = await priya.post("/api/author/tickets").send({ bookId: "DROP TABLE", subject: "Hi", description: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["bookId", "description", "subject"]);
  });

  it("rejects invalid IDs, unknown tickets and mass-assignment attempts", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const admin = await loginAs(app, ADMIN);
    const id = (await priya.post("/api/author/tickets").send(sampleTicket)).body.ticket.id;

    expect((await admin.get("/api/admin/tickets/abc")).status).toBe(400);
    expect((await admin.get("/api/admin/tickets/99999")).status).toBe(404);
    const mass = await admin.patch(`/api/admin/tickets/${id}`).send({ author_id: "AUTH002", created_at: "2000-01-01" });
    expect(mass.status).toBe(400);
    expect((await admin.patch(`/api/admin/tickets/${id}`).send({ status: "Done" })).status).toBe(400);
    expect((await admin.patch(`/api/admin/tickets/${id}`).send({})).status).toBe(400);
    // Assigning to an author account is refused.
    expect((await admin.patch(`/api/admin/tickets/${id}`).send({ assigneeId: 1 })).status).toBe(400);
    expect((await admin.get("/api/admin/no-such-route")).status).toBe(404);
  });

  it("filters, searches, sorts and paginates the admin queue", async () => {
    const { app, triage } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const sneha = await loginAs(app, AUTHORS.sneha);
    const admin = await loginAs(app, ADMIN);
    const admin2 = await loginAs(app, ADMIN_2);

    await priya.post("/api/author/tickets").send(sampleTicket);
    await sneha.post("/api/author/tickets").send({
      bookId: "BK011",
      subject: "Wrong ISBN on Amazon",
      description: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
    });
    await sneha.post("/api/author/tickets").send({ bookId: "", subject: "Update author bio", description: "Can I update my author bio on the BookLeaf store?" });
    await triage.idle();

    const byCategory = await admin.get("/api/admin/tickets").query({ category: "ISBN & Metadata Issues" });
    expect(byCategory.body.items.map((t: { subject: string }) => t.subject)).toEqual(["Wrong ISBN on Amazon"]);

    const search = await admin.get("/api/admin/tickets").query({ q: "Priya" });
    expect(search.body.total).toBe(1);
    // LIKE wildcards in search input are treated literally.
    expect((await admin.get("/api/admin/tickets").query({ q: "%" })).body.total).toBe(0);

    const page = await admin.get("/api/admin/tickets").query({ pageSize: 2, page: 2, sort: "oldest" });
    expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.body.items).toHaveLength(1);

    // Urgency sort puts the High ISBN issue above the Low bio question.
    const urgency = (await admin.get("/api/admin/tickets")).body.items.map((t: { priority: string }) => t.priority);
    expect(urgency.indexOf("High")).toBeLessThan(urgency.indexOf("Low"));

    const isbnId = byCategory.body.items[0].id;
    const admin2Id = (await admin2.get("/api/auth/me")).body.user.id;
    await admin2.patch(`/api/admin/tickets/${isbnId}`).send({ assigneeId: admin2Id });
    expect((await admin2.get("/api/admin/tickets").query({ assignee: "me" })).body.total).toBe(1);
    expect((await admin.get("/api/admin/tickets").query({ assignee: "me" })).body.total).toBe(0);
    expect((await admin.get("/api/admin/tickets").query({ assignee: "unassigned" })).body.total).toBe(2);

    expect((await admin.get("/api/admin/tickets").query({ status: "Open,Resolved" })).body.total).toBe(3);
    expect((await admin.get("/api/admin/tickets").query({ status: "Bogus" })).status).toBe(400);
    expect((await admin.get("/api/admin/tickets").query({ createdFrom: "2000-01-01", createdTo: "2000-01-02" })).body.total).toBe(0);
  });

  it("flags tickets waiting longer than their response target as overdue", async () => {
    const { app, db, triage } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const admin = await loginAs(app, ADMIN);
    const id = (await priya.post("/api/author/tickets").send(sampleTicket)).body.ticket.id;
    await triage.idle();
    const threeDaysAgo = new Date(Date.now() - 72 * 3600_000).toISOString();
    db.prepare("UPDATE tickets SET awaiting_since = ?, created_at = ? WHERE id = ?").run(threeDaysAgo, threeDaysAgo, id);

    expect((await admin.get(`/api/admin/tickets/${id}`)).body.ticket.overdue).toBe(true);
    expect((await admin.get("/api/admin/tickets").query({ overdue: "true" })).body.total).toBe(1);
    expect((await admin.get("/api/admin/stats")).body.overdue).toBe(1);

    // Replying stops the clock.
    await admin.post(`/api/admin/tickets/${id}/messages`).send({ body: "We're on it." });
    expect((await admin.get(`/api/admin/tickets/${id}`)).body.ticket.overdue).toBe(false);
  });

  it("returns author dashboard numbers from the author's own records, handling in-production books", async () => {
    const { app } = await createTestApp(failingProvider());
    const sneha = await loginAs(app, AUTHORS.sneha);
    const summary = (await sneha.get("/api/author/summary")).body;
    expect(summary).toMatchObject({
      books: { total: 3, live: 2, inProduction: 1 },
      copiesSold: 1567 + 723,
      royaltyPending: 4175 + 3690,
      tickets: { active: 0, resolved: 0, total: 0 },
    });
  });
});
