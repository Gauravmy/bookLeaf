import request from "supertest";
import { describe, expect, it } from "vitest";
import { ADMIN, AUTHORS, TEST_PASSWORD, createTestApp, failingProvider, loginAs } from "./helpers.js";

describe("authentication", () => {
  it("logs in with valid credentials and sets an httpOnly session cookie", async () => {
    const { app } = await createTestApp(failingProvider());
    const res = await request(app).post("/api/auth/login").send({ email: AUTHORS.priya, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: expect.any(Number), email: AUTHORS.priya, name: "Priya Sharma", role: "author", authorId: "AUTH001" });
    expect(res.body.user.password_hash).toBeUndefined();
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/bl_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("is case-insensitive on email", async () => {
    const { app } = await createTestApp(failingProvider());
    const res = await request(app).post("/api/auth/login").send({ email: "PRIYA.Sharma@email.com", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong password and an unknown email with the same error", async () => {
    const { app } = await createTestApp(failingProvider());
    const wrong = await request(app).post("/api/auth/login").send({ email: AUTHORS.priya, password: "nope-nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@email.com", password: "nope-nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("validates the login body", async () => {
    const { app } = await createTestApp(failingProvider());
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("returns 400 for malformed JSON instead of a 500", async () => {
    const { app } = await createTestApp(failingProvider());
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
  });

  it("returns the current user, and logout invalidates the session server-side", async () => {
    const { app } = await createTestApp(failingProvider());
    const agent = await loginAs(app, ADMIN);
    expect((await agent.get("/api/auth/me")).body.user.role).toBe("admin");
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("rate-limits repeated failed logins for one account", async () => {
    const { app } = await createTestApp(failingProvider());
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await request(app).post("/api/auth/login").send({ email: AUTHORS.sneha, password: "wrong-password" })).status;
    }
    expect(last).toBe(429);
  });

  it("rejects state-changing requests from a foreign origin", async () => {
    const { app } = await createTestApp(failingProvider());
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: AUTHORS.priya, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });
});
