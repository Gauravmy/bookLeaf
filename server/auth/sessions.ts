import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db/connection.js";
import type { PublicUser, Role } from "../../shared/domain.js";

export const SESSION_COOKIE = "bl_session";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  author_id: string | null;
}

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  authorId: row.author_id,
});

/** Opaque random token in an httpOnly cookie; only its hash is stored, so a DB leak cannot hijack sessions. */
export function createSession(db: DB, userId: number, ttlHours: number) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now.toISOString(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function findSessionUser(db: DB, token: string): PublicUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.author_id
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), new Date().toISOString()) as UserRow | undefined;
  return row ? toPublicUser(row) : null;
}

export function deleteSession(db: DB, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function purgeExpiredSessions(db: DB) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}
