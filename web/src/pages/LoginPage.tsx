import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Layout";
import { Notice, Spinner } from "../components/ui";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/author"} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      const home = signedIn.role === "admin" ? "/admin" : "/author";
      navigate(from?.startsWith(home) ? from : home, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <Logo />
        <h1>Sign in</h1>
        <p className="muted">Authors and BookLeaf support staff sign in here.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <form onSubmit={onSubmit} className="form" noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email || !password}>
            {busy && <Spinner label="Signing in" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
