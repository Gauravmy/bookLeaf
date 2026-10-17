import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "../../../shared/domain";
import { ApiError, api } from "../api/client";

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: PublicUser }>("/api/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: (vars: { email: string; password: string }) => api.post<{ user: PublicUser }>("/api/auth/login", vars),
    onSuccess: ({ user }) => {
      // Drop anything cached for a previous user before showing the new one.
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
    },
  });

  const value: AuthState = {
    user: me.data ?? null,
    loading: me.isPending,
    login: async (email, password) => (await loginMutation.mutateAsync({ email, password })).user,
    logout: async () => {
      await api.post("/api/auth/logout").catch(() => undefined);
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
