import { useEffect, useRef, useState } from "react";
import type { AdminTicketDetail, TicketStatus } from "../../../../shared/domain";
import { ApiError, errorMessage } from "../../api/client";
import { useCachedDraft, useGenerateDraft, useHealth, useSendReply } from "../../api/queries";
import { ConfirmDialog, Notice, Spinner } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const AFTER_SEND: { value: TicketStatus | ""; label: string }[] = [
  { value: "", label: "Keep current status" },
  { value: "In Progress", label: "Mark In Progress" },
  { value: "Resolved", label: "Mark Resolved" },
];

/**
 * Reply editor with the AI draft. The draft is generated once per ticket (and
 * cached server-side), pre-fills an empty editor, and is only ever sent after
 * the admin reviews it and confirms.
 */
export function ReplyComposer({ ticket }: { ticket: AdminTicketDetail }) {
  const health = useHealth();
  const cached = useCachedDraft(ticket.id);
  const generate = useGenerateDraft(ticket.id);
  const send = useSendReply(ticket.id);
  const [body, setBody] = useState("");
  const [after, setAfter] = useState<TicketStatus | "">(ticket.status === "Open" ? "In Progress" : "");
  const [confirming, setConfirming] = useState<"send" | "regenerate" | null>(null);
  const [sentNotice, setSentNotice] = useState(false);
  const insertedDraftAt = useRef<string | null>(null);
  const autoRequested = useRef(false);

  const aiConfigured = health.data?.ai.configured ?? false;
  const draft = generate.data ?? cached.data ?? null;

  // Present a draft when the ticket is opened: request one automatically only
  // if AI is configured and there is no current cached draft.
  useEffect(() => {
    if (autoRequested.current || !aiConfigured || cached.isPending || cached.isError) return;
    if (cached.data && !cached.data.stale) return;
    autoRequested.current = true;
    generate.mutate(false);
  }, [aiConfigured, cached.isPending, cached.isError, cached.data, generate]);

  // Pre-fill the editor with a new draft, but never overwrite the admin's own text.
  useEffect(() => {
    if (!draft || draft.stale || insertedDraftAt.current === draft.createdAt) return;
    if (body.trim() === "") setBody(draft.body);
    insertedDraftAt.current = draft.createdAt;
  }, [draft, body]);

  const aiError = generate.error instanceof ApiError && generate.error.code === "ai_unavailable" ? generate.error : null;
  const editedFromDraft = draft && body.trim() !== "" && body.trim() !== draft.body.trim();

  async function doSend() {
    try {
      await send.mutateAsync({ body: body.trim(), status: after || undefined });
      setBody("");
      setSentNotice(true);
      insertedDraftAt.current = draft?.createdAt ?? null;
    } catch {
      // Shown via send.error; the text stays in the editor so nothing is lost.
    } finally {
      setConfirming(null);
    }
  }

  function regenerate() {
    setConfirming(null);
    setBody("");
    insertedDraftAt.current = null;
    generate.mutate(true);
  }

  return (
    <section className="card composer" aria-labelledby="composer-title">
      <div className="card-head">
        <h2 id="composer-title">Reply to {ticket.author.name}</h2>
        {aiConfigured && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={generate.isPending}
            onClick={() => (body.trim() && body.trim() !== draft?.body.trim() ? setConfirming("regenerate") : regenerate())}
          >
            {draft ? "Regenerate AI draft" : "Generate AI draft"}
          </button>
        )}
      </div>

      {sentNotice && <Notice tone="success">Reply sent. The author can see it now.</Notice>}

      {!health.isPending && !aiConfigured && (
        <Notice tone="info">AI drafting is not configured on this server. Write the reply manually below.</Notice>
      )}
      {generate.isPending && (
        <div className="draft-loading">
          <Spinner label="Drafting" /> Drafting a reply from the knowledge base and this author's records…
        </div>
      )}
      {aiError && (
        <Notice tone="warning">
          {aiError.message}{" "}
          <button className="link-button" onClick={() => generate.mutate(true)}>
            Try again
          </button>
        </Notice>
      )}
      {generate.isError && !aiError && <Notice tone="error">{errorMessage(generate.error)}</Notice>}

      {draft && !generate.isPending && (
        <div className="draft-meta">
          <span className="source source-ai">AI draft</span>
          <span className="muted small">
            {draft.stale ? "Out of date - the author has written since. Regenerate for an updated draft." : `Generated ${formatDateTime(draft.createdAt)} by ${draft.model}. Review before sending.`}
          </span>
          {draft.checklist.length > 0 && (
            <div className="checklist">
              <strong>Before sending, check:</strong>
              <ul>
                {draft.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="reply-body" className="sr-only">
          Reply
        </label>
        <textarea
          id="reply-body"
          rows={12}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSentNotice(false);
          }}
          placeholder="Write a reply to the author…"
          maxLength={10000}
        />
        {editedFromDraft && <p className="field-help">Edited from the AI draft.</p>}
      </div>

      {send.isError && <Notice tone="error">{errorMessage(send.error)}</Notice>}
      <div className="form-actions">
        <label className="inline-field">
          <span className="muted small">After sending</span>
          <select value={after} onChange={(e) => setAfter(e.target.value as TicketStatus | "")}>
            {AFTER_SEND.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={!body.trim() || send.isPending} onClick={() => setConfirming("send")}>
          Send reply
        </button>
      </div>

      <ConfirmDialog
        open={confirming === "send"}
        title="Send this reply?"
        confirmLabel="Send to author"
        busy={send.isPending}
        onConfirm={doSend}
        onCancel={() => setConfirming(null)}
      >
        <p>
          {ticket.author.name} will see this reply immediately.
          {after ? ` The ticket will be marked ${after}.` : ""}
        </p>
        {draft && draft.checklist.length > 0 && <p className="muted small">Have you completed the checklist items from the AI draft?</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === "regenerate"}
        title="Replace your reply?"
        confirmLabel="Regenerate"
        tone="danger"
        onConfirm={regenerate}
        onCancel={() => setConfirming(null)}
      >
        <p>Regenerating discards the text currently in the editor.</p>
      </ConfirmDialog>
    </section>
  );
}
