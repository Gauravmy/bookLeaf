import request from "supertest";
import { describe, expect, it } from "vitest";
import { ADMIN, AUTHORS, createTestApp, failingProvider, loginAs, sampleTicket } from "./helpers.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("authorization", () => {
  it("rejects unauthenticated access to every protected area", async () => {
    const { app } = await createTestApp(failingProvider());
    for (const path of ["/api/author/books", "/api/author/tickets", "/api/admin/tickets", "/api/admin/stats", "/api/events", "/api/attachments/1"]) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });

  it("shows authors only their own books", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const res = await priya.get("/api/author/books");
    expect(res.body.books.map((b: { id: string }) => b.id).sort()).toEqual(["BK001", "BK002"]);
  });

  it("prevents an author reading or replying to another author's ticket", async () => {
    const { app, triage } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const sneha = await loginAs(app, AUTHORS.sneha);
    const created = await priya.post("/api/author/tickets").send(sampleTicket);
    const id = created.body.ticket.id;
    await triage.idle();

    expect((await sneha.get(`/api/author/tickets/${id}`)).status).toBe(404);
    expect((await sneha.post(`/api/author/tickets/${id}/messages`).send({ body: "hi" })).status).toBe(404);
    expect((await sneha.get("/api/author/tickets")).body.tickets).toEqual([]);
  });

  it("prevents filing a ticket against another author's book", async () => {
    const { app } = await createTestApp(failingProvider());
    const sneha = await loginAs(app, AUTHORS.sneha);
    const res = await sneha.post("/api/author/tickets").send({ ...sampleTicket, bookId: "BK001" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not found in your account/);
  });

  it("blocks authors from every admin endpoint, even with crafted requests", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const id = (await priya.post("/api/author/tickets").send(sampleTicket)).body.ticket.id;
    const attempts = [
      priya.get("/api/admin/tickets"),
      priya.get(`/api/admin/tickets/${id}`),
      priya.patch(`/api/admin/tickets/${id}`).send({ status: "Resolved" }),
      priya.post(`/api/admin/tickets/${id}/messages`).send({ body: "fake admin reply" }),
      priya.post(`/api/admin/tickets/${id}/notes`).send({ body: "x" }),
      priya.post(`/api/admin/tickets/${id}/draft`).send({}),
      priya.post(`/api/admin/tickets/${id}/triage`).send({}),
      priya.get("/api/admin/stats"),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
    const mine = await priya.get(`/api/author/tickets/${id}`);
    expect(mine.body.ticket.status).toBe("Open");
    expect(mine.body.ticket.messages).toEqual([]);
  });

  it("blocks admins from author-only endpoints", async () => {
    const { app } = await createTestApp(failingProvider());
    const admin = await loginAs(app, ADMIN);
    expect((await admin.post("/api/author/tickets").send(sampleTicket)).status).toBe(403);
  });

  it("never exposes internal notes or triage internals to the author", async () => {
    const { app, triage } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const admin = await loginAs(app, ADMIN);
    const id = (await priya.post("/api/author/tickets").send(sampleTicket)).body.ticket.id;
    await triage.idle();
    await admin.post(`/api/admin/tickets/${id}/notes`).send({ body: "SECRET: check bank file before replying" });

    const adminView = await admin.get(`/api/admin/tickets/${id}`);
    expect(adminView.body.ticket.notes).toHaveLength(1);

    const authorView = JSON.stringify((await priya.get(`/api/author/tickets/${id}`)).body);
    const authorList = JSON.stringify((await priya.get("/api/author/tickets")).body);
    for (const payload of [authorView, authorList]) {
      expect(payload).not.toContain("SECRET");
      expect(payload).not.toContain("notes");
      expect(payload).not.toContain("triageRationale");
      expect(payload).not.toContain("assignee");
    }
  });

  it("restricts attachment downloads to the ticket owner and admins", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const sneha = await loginAs(app, AUTHORS.sneha);
    const admin = await loginAs(app, ADMIN);
    const created = await priya
      .post("/api/author/tickets")
      .field("bookId", "BK001")
      .field("subject", "Blurry print on author copies")
      .field("description", "The images in my author copies are blurry and pages are misaligned.")
      .attach("attachment", PNG, { filename: "../../photo.png", contentType: "image/png" });
    expect(created.status).toBe(201);
    const attachment = created.body.ticket.attachments[0];
    expect(attachment).toMatchObject({ filename: "photo.png", mimeType: "image/png" });

    expect((await sneha.get(`/api/attachments/${attachment.id}`)).status).toBe(404);
    const ok = await priya.get(`/api/attachments/${attachment.id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect((await admin.get(`/api/attachments/${attachment.id}`)).status).toBe(200);
  });

  it("rejects attachments whose content is not an allowed type, whatever the extension says", async () => {
    const { app } = await createTestApp(failingProvider());
    const priya = await loginAs(app, AUTHORS.priya);
    const res = await priya
      .post("/api/author/tickets")
      .field("subject", "General question here")
      .field("description", "Please see attached file for details of my question.")
      .attach("attachment", Buffer.from("<script>alert(1)</script>"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect((await priya.get("/api/author/tickets")).body.tickets).toHaveLength(0);
  });
});
