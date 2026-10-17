import type { TicketAttachment, TicketMessage } from "../../../shared/domain";
import { formatBytes, formatDateTime } from "../lib/format";

/** The original query followed by the author-visible conversation. */
export function TicketThread({
  authorName,
  description,
  createdAt,
  messages,
  attachments,
  viewer,
}: {
  authorName: string;
  description: string;
  createdAt: string;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  viewer: "author" | "admin";
}) {
  return (
    <ol className="thread" aria-label="Conversation">
      <li className="msg msg-author msg-original">
        <div className="msg-head">
          <strong>{viewer === "author" ? "You" : authorName}</strong>
          <span className="muted">· original query · {formatDateTime(createdAt)}</span>
        </div>
        <p className="msg-body">{description}</p>
        {attachments.length > 0 && (
          <ul className="attachments">
            {attachments.map((a) => (
              <li key={a.id}>
                <a href={`/api/attachments/${a.id}`} download>
                  📎 {a.filename}
                </a>{" "}
                <span className="muted">({formatBytes(a.sizeBytes)})</span>
              </li>
            ))}
          </ul>
        )}
      </li>
      {messages.map((m) => (
        <li key={m.id} className={`msg ${m.senderRole === "admin" ? "msg-admin" : "msg-author"}`}>
          <div className="msg-head">
            <strong>
              {m.senderRole === "admin" ? `${m.senderName} · BookLeaf Support` : viewer === "author" ? "You" : m.senderName}
            </strong>
            <span className="muted">· {formatDateTime(m.createdAt)}</span>
          </div>
          <p className="msg-body">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
