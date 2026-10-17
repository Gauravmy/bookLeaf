import { useEffect, useId, useRef, type ReactNode } from "react";
import type { TicketPriority, TicketStatus, TriageSource } from "../../../shared/domain";
import { errorMessage } from "../api/client";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${slug(status)}`}>{status}</span>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority | null }) {
  if (!priority) return <span className="badge priority-pending">Triaging…</span>;
  return (
    <span className={`badge priority-${slug(priority)}`}>
      <span className="dot" aria-hidden="true" />
      {priority}
    </span>
  );
}

const SOURCE_LABEL: Record<TriageSource, string> = { ai: "AI", rules: "Rules", admin: "Edited", pending: "Pending" };
const SOURCE_TITLE: Record<TriageSource, string> = {
  ai: "Suggested by the AI model",
  rules: "Keyword fallback (AI was unavailable) - please double-check",
  admin: "Set by an admin",
  pending: "Automatic triage has not finished yet",
};

export function SourceTag({ source }: { source: TriageSource }) {
  return (
    <span className={`source source-${source}`} title={SOURCE_TITLE[source]}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state">
      <Spinner label={label} />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "success" | "warning" | "error"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "danger" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** Accessible modal confirmation using the native <dialog> element (focus trapping and Esc built in). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(e) => (e.preventDefault(), onCancel())}>
      <h2 id={titleId}>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? <Spinner label="Working" /> : null}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}
