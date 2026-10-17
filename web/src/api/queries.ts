import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminTicketDetail,
  AdminTicketSummary,
  AiDraft,
  AuthorProfile,
  AuthorTicket,
  Book,
  Paginated,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "../../../shared/domain";
import { api } from "./client";
import { useFallbackPolling } from "../lib/liveUpdates";

// ---------------------------------------------------------------- author

export interface AuthorSummary {
  books: { total: number; live: number; inProduction: number };
  copiesSold: number;
  royaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  tickets: { active: number; resolved: number; total: number };
}

export const useAuthorProfile = () =>
  useQuery({ queryKey: ["profile"], queryFn: async () => (await api.get<{ author: AuthorProfile }>("/api/author/profile")).author });

export const useAuthorSummary = () =>
  useQuery({ queryKey: ["summary"], queryFn: () => api.get<AuthorSummary>("/api/author/summary") });

export const useMyBooks = () =>
  useQuery({ queryKey: ["books"], queryFn: async () => (await api.get<{ books: Book[] }>("/api/author/books")).books });

export function useMyTickets() {
  const refetchInterval = useFallbackPolling();
  return useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: async () => (await api.get<{ tickets: AuthorTicket[] }>("/api/author/tickets")).tickets,
    refetchInterval,
  });
}

export function useMyTicket(id: number) {
  const refetchInterval = useFallbackPolling();
  return useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => (await api.get<{ ticket: AuthorTicket }>(`/api/author/tickets/${id}`)).ticket,
    refetchInterval,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.post<{ ticket: AuthorTicket }>("/api/author/tickets", form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}

export function useAuthorReply(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<{ ticket: AuthorTicket }>(`/api/author/tickets/${id}/messages`, { body }),
    onSuccess: ({ ticket }) => {
      qc.setQueryData(["ticket", id], ticket);
      void qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

// ---------------------------------------------------------------- admin

export interface AdminStats {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  unassigned: number;
  urgent: number;
  overdue: number;
  byCategory: { category: string; count: number }[];
  avgFirstResponseHours: number | null;
  respondedTickets: number;
}

export function useAdminStats() {
  const refetchInterval = useFallbackPolling();
  return useQuery({ queryKey: ["stats"], queryFn: () => api.get<AdminStats>("/api/admin/stats"), refetchInterval });
}

export function useAdminQueue(params: URLSearchParams) {
  const refetchInterval = useFallbackPolling();
  const qs = params.toString();
  return useQuery({
    queryKey: ["tickets", "queue", qs],
    queryFn: () => api.get<Paginated<AdminTicketSummary>>(`/api/admin/tickets?${qs}`),
    placeholderData: (prev) => prev,
    refetchInterval,
  });
}

export function useAdminTicket(id: number) {
  const refetchInterval = useFallbackPolling();
  return useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => (await api.get<{ ticket: AdminTicketDetail }>(`/api/admin/tickets/${id}`)).ticket,
    refetchInterval,
  });
}

export const useAdmins = () =>
  useQuery({
    queryKey: ["admins"],
    queryFn: async () => (await api.get<{ admins: { id: number; name: string; email: string }[] }>("/api/admin/admins")).admins,
    staleTime: 5 * 60_000,
  });

export const useHealth = () =>
  useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ status: string; ai: { configured: boolean; model: string } }>("/api/health"),
    staleTime: 5 * 60_000,
  });

export interface TicketPatch {
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assigneeId?: number | null;
}

/** Shared success handler: put the fresh ticket in the cache and refresh lists. */
function useTicketUpdater(id: number) {
  const qc = useQueryClient();
  return ({ ticket }: { ticket: AdminTicketDetail }) => {
    qc.setQueryData(["ticket", id], ticket);
    void qc.invalidateQueries({ queryKey: ["tickets"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
  };
}

export function useUpdateTicket(id: number) {
  const onSuccess = useTicketUpdater(id);
  return useMutation({
    mutationFn: (patch: TicketPatch) => api.patch<{ ticket: AdminTicketDetail }>(`/api/admin/tickets/${id}`, patch),
    onSuccess,
  });
}

export function useSendReply(id: number) {
  const onSuccess = useTicketUpdater(id);
  return useMutation({
    mutationFn: (vars: { body: string; status?: TicketStatus }) => api.post<{ ticket: AdminTicketDetail }>(`/api/admin/tickets/${id}/messages`, vars),
    onSuccess,
  });
}

export function useAddNote(id: number) {
  const onSuccess = useTicketUpdater(id);
  return useMutation({
    mutationFn: (body: string) => api.post<{ ticket: AdminTicketDetail }>(`/api/admin/tickets/${id}/notes`, { body }),
    onSuccess,
  });
}

export function useRerunTriage(id: number) {
  const onSuccess = useTicketUpdater(id);
  return useMutation({
    mutationFn: () => api.post<{ ticket: AdminTicketDetail }>(`/api/admin/tickets/${id}/triage`),
    onSuccess,
  });
}

export const useCachedDraft = (id: number) =>
  useQuery({
    queryKey: ["draft", id],
    queryFn: async () => (await api.get<{ draft: AiDraft | null }>(`/api/admin/tickets/${id}/draft`)).draft,
  });

export function useGenerateDraft(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (force: boolean) => (await api.post<{ draft: AiDraft }>(`/api/admin/tickets/${id}/draft`, { force })).draft,
    onSuccess: (draft) => qc.setQueryData(["draft", id], draft),
  });
}
