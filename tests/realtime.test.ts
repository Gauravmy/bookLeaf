import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ADMIN, AUTHORS, TEST_PASSWORD, createTestApp, failingProvider, sampleTicket } from "./helpers.js";

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function login(base: string, email: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

/** Opens an SSE stream and collects ticket events. */
async function listen(base: string, cookie: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, { headers: { cookie }, signal: controller.signal });
  const events: { ticketId: number; kind: string }[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (chunk.includes("event: ticket") && data) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { events, close: () => controller.abort(), contentType: res.headers.get("content-type") };
}

const waitFor = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for event");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("real-time updates (SSE)", () => {
  it("pushes an admin reply to the ticket's author but not to other authors", async () => {
    const { app, triage } = await createTestApp(failingProvider());
    server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const priyaCookie = await login(base, AUTHORS.priya);
    const snehaCookie = await login(base, AUTHORS.sneha);
    const adminCookie = await login(base, ADMIN);

    const priyaStream = await listen(base, priyaCookie);
    const snehaStream = await listen(base, snehaCookie);
    expect(priyaStream.contentType).toContain("text/event-stream");

    const created = await fetch(`${base}/api/author/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: priyaCookie },
      body: JSON.stringify(sampleTicket),
    });
    const { ticket } = (await created.json()) as { ticket: { id: number } };
    await triage.idle();

    await fetch(`${base}/api/admin/tickets/${ticket.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ body: "We are on it." }),
    });

    await waitFor(() => priyaStream.events.some((e) => e.kind === "message" && e.ticketId === ticket.id));
    // Events carry IDs only - content must be fetched through the authorised API.
    expect(Object.keys(priyaStream.events[0]!).sort()).toEqual(["kind", "ticketId"]);
    expect(snehaStream.events).toEqual([]);

    priyaStream.close();
    snehaStream.close();
  });
});
