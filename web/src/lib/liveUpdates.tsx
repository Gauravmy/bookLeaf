import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type LiveStatus = "connecting" | "live" | "offline";

const LiveContext = createContext<LiveStatus>("offline");

/**
 * Subscribes to /api/events (Server-Sent Events) while signed in. Events only
 * carry a ticket ID, so we invalidate the relevant queries and let React Query
 * refetch through the normal authorised endpoints. EventSource reconnects on
 * its own; while disconnected, queries fall back to polling (see POLL_MS).
 */
export function LiveUpdatesProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("offline");

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");
    setStatus("connecting");
    source.onopen = () => {
      setStatus("live");
      // Catch up on anything missed while disconnected.
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    };
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    source.addEventListener("ticket", (e) => {
      const { ticketId } = JSON.parse((e as MessageEvent).data) as { ticketId: number };
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    });
    return () => {
      source.close();
      setStatus("offline");
    };
  }, [enabled, queryClient]);

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveContext);

/** Polling interval used only when the live connection is down. */
export const POLL_MS = 20_000;
export const useFallbackPolling = () => (useLiveStatus() === "live" ? false : POLL_MS);
