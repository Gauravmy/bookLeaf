import multer from "multer";
import { badRequest } from "./errors.js";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Allowed types, checked by file signature ("magic bytes") rather than trusting
// the client-supplied Content-Type or extension.
const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "application/pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
];

export const singleAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 10 },
}).single("attachment");

export function detectAllowedMime(data: Buffer): string {
  const match = SIGNATURES.find((s) => s.test(data));
  if (!match) throw badRequest("Attachment must be a PNG, JPEG, WEBP image or a PDF");
  return match.mime;
}

/** Strip path components and control characters from a client-supplied filename. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "attachment";
  const cleaned = base.replace(/[^\w.\- ()]/g, "_").slice(0, 120).trim();
  return cleaned || "attachment";
}
