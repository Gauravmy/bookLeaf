import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, errorMessage } from "../../api/client";
import { useCreateTicket, useMyBooks } from "../../api/queries";
import { FieldError, Notice, Spinner } from "../../components/ui";
import { formatBytes } from "../../lib/format";

// Mirrors the server limits; the server re-validates everything.
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const DESCRIPTION_MAX = 5000;

export function NewTicketPage() {
  const books = useMyBooks();
  const create = useCreateTicket();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [bookId, setBookId] = useState(params.get("book") ?? "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const next = { ...errors };
    delete next.attachment;
    if (f && !ACCEPT.includes(f.type)) next.attachment = "Please attach a PNG, JPEG or WEBP image, or a PDF.";
    else if (f && f.size > MAX_BYTES) next.attachment = "Attachments must be 5 MB or smaller.";
    setErrors(next);
    setFile(next.attachment ? null : f);
    if (next.attachment) e.target.value = "";
  }

  function validate() {
    const next: Record<string, string> = {};
    if (subject.trim().length < 5) next.subject = "Please add a short subject (at least 5 characters).";
    if (description.trim().length < 20) next.description = "Please describe the issue in at least 20 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    const form = new FormData();
    form.set("bookId", bookId);
    form.set("subject", subject.trim());
    form.set("description", description.trim());
    if (file) form.set("attachment", file);
    try {
      const { ticket } = await create.mutateAsync(form);
      navigate(`/author/tickets/${ticket.id}`, { state: { created: true } });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    }
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Raise a support ticket</h1>
          <p className="muted">Tell us what's going on. Replies from our team appear on the ticket as soon as they're sent.</p>
        </div>
      </div>
      {formError && <Notice tone="error">{formError}</Notice>}
      <form className="card form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="book">Which book is this about?</label>
          <select id="book" value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={books.isPending} aria-describedby="book-error">
            <option value="">General / Account Level</option>
            {books.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title} ({b.status})
              </option>
            ))}
          </select>
          {books.isError && <p className="field-error">Couldn't load your books; you can still submit a general ticket.</p>}
          <FieldError id="book-error" message={errors.bookId} />
        </div>

        <div className="field">
          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            maxLength={150}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-invalid={Boolean(errors.subject)}
            aria-describedby="subject-error"
            placeholder="e.g. Royalty for last quarter not received"
          />
          <FieldError id="subject-error" message={errors.subject} />
        </div>

        <div className="field">
          <label htmlFor="description">Details</label>
          <textarea
            id="description"
            rows={8}
            maxLength={DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby="description-help description-error"
            placeholder="Include anything that helps: dates, platform names, order numbers, what you expected to happen."
          />
          <p className="field-help" id="description-help">
            {description.length}/{DESCRIPTION_MAX}
          </p>
          <FieldError id="description-error" message={errors.description} />
        </div>

        <div className="field">
          <label htmlFor="attachment">Attachment (optional)</label>
          <input id="attachment" type="file" accept={ACCEPT.join(",")} onChange={onFile} aria-describedby="attachment-help attachment-error" />
          <p className="field-help" id="attachment-help">
            One PNG, JPEG, WEBP or PDF up to 5 MB - e.g. photos of a printing defect.
            {file ? ` Selected: ${file.name} (${formatBytes(file.size)}).` : ""}
          </p>
          <FieldError id="attachment-error" message={errors.attachment} />
        </div>

        <div className="form-actions">
          <Link to="/author/tickets" className="btn btn-secondary">
            Cancel
          </Link>
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {create.isPending && <Spinner label="Submitting" />}
            Submit ticket
          </button>
        </div>
      </form>
    </div>
  );
}
