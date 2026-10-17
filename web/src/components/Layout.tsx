import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLiveStatus } from "../lib/liveUpdates";

const NAV = {
  author: [
    { to: "/author", label: "Dashboard", end: true },
    { to: "/author/books", label: "My Books" },
    { to: "/author/tickets", label: "My Tickets", end: true },
    { to: "/author/tickets/new", label: "New Ticket" },
  ],
  admin: [{ to: "/admin", label: "Ticket Queue", end: true }],
};

function LiveIndicator() {
  const status = useLiveStatus();
  const label = status === "live" ? "Live" : status === "connecting" ? "Reconnecting…" : "Offline - refreshing periodically";
  return (
    <span className={`live live-${status}`} title="Ticket updates appear without refreshing">
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
        <path d="M6 26C6 12 14 6 26 6c0 12-6 20-20 20z" fill="currentColor" />
        <path d="M8 24C13 19 17 15 22 10" stroke="var(--surface)" strokeWidth="1.6" fill="none" />
      </svg>
      BookLeaf
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const links = NAV[user.role];

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <span className="brand-sub">{user.role === "admin" ? "Support Operations" : "Author Portal"}</span>
          </div>
          <nav aria-label="Main" className="nav">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <LiveIndicator />
            <span className="user-name" title={user.email}>
              {user.name}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await logout();
                navigate("/login", { replace: true });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
