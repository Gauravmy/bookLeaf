import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Role } from "../../shared/domain";
import { ApiError } from "./api/client";
import { AuthProvider, useAuth } from "./lib/auth";
import { LiveUpdatesProvider } from "./lib/liveUpdates";
import { Layout } from "./components/Layout";
import { LoadingBlock } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { AuthorDashboard } from "./pages/author/AuthorDashboard";
import { BooksPage } from "./pages/author/BooksPage";
import { NewTicketPage } from "./pages/author/NewTicketPage";
import { MyTicketsPage } from "./pages/author/MyTicketsPage";
import { AuthorTicketPage } from "./pages/author/AuthorTicketPage";
import { QueuePage } from "./pages/admin/QueuePage";
import { AdminTicketPage } from "./pages/admin/AdminTicketPage";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Don't retry client errors such as 401/403/404; they won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingBlock />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // The server enforces roles too; this only keeps users on pages they can use.
  if (user.role !== role) return <Navigate to={user.role === "admin" ? "/admin" : "/author"} replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingBlock />;
  return <Navigate to={!user ? "/login" : user.role === "admin" ? "/admin" : "/author"} replace />;
}

function NotFound() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>
        <a href="/">Go to your dashboard</a>
      </p>
    </div>
  );
}

function App() {
  const { user } = useAuth();
  return (
    <LiveUpdatesProvider enabled={Boolean(user)}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/author"
          element={
            <RequireRole role="author">
              <Layout />
            </RequireRole>
          }
        >
          <Route index element={<AuthorDashboard />} />
          <Route path="books" element={<BooksPage />} />
          <Route path="tickets" element={<MyTicketsPage />} />
          <Route path="tickets/new" element={<NewTicketPage />} />
          <Route path="tickets/:id" element={<AuthorTicketPage />} />
        </Route>
        <Route
          path="/admin"
          element={
            <RequireRole role="admin">
              <Layout />
            </RequireRole>
          }
        >
          <Route index element={<QueuePage />} />
          <Route path="tickets/:id" element={<AdminTicketPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </LiveUpdatesProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
