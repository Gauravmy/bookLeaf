import type { Request, Response } from "express";
import type { PublicUser } from "../../shared/domain.js";

/**
 * In-process pub/sub that pushes "ticket changed" notifications to browsers
 * over Server-Sent Events. Events carry only IDs - clients refetch through the
 * normal authorised REST endpoints, so SSE can never leak ticket content.
 *
 * Single-process by design; running several instances would need a shared
 * broker (e.g. Redis pub/sub or Postgres LISTEN/NOTIFY). See README limitations.
 */
export interface TicketChange {
  ticketId: number;
  authorId: string;
  kind: "created" | "updated" | "message" | "triaged";
}

interface Client {
  user: PublicUser;
  res: Response;
}

export class TicketEventBus {
  private clients = new Set<Client>();

  publish(change: TicketChange) {
    const payload = `event: ticket\ndata: ${JSON.stringify({ ticketId: change.ticketId, kind: change.kind })}\n\n`;
    for (const client of this.clients) {
      // Authors only hear about their own tickets; admins hear about everything.
      if (client.user.role === "admin" || client.user.authorId === change.authorId) {
        client.res.write(payload);
      }
    }
  }

  /** Express handler body for GET /api/events (mounted behind requireAuth). */
  subscribe(req: Request, res: Response, user: PublicUser) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (nginx/Render)
    });
    res.write("retry: 5000\n\n");
    const client: Client = { user, res };
    this.clients.add(client);
    // Comment heartbeats keep idle connections open through proxies.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(client);
    });
  }

  get connectionCount() {
    return this.clients.size;
  }
}
