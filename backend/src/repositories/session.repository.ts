import type { Queryable } from '../db/database.js';
import { one } from '../db/database.js';

export interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

export async function insertSession(
  q: Queryable,
  s: { userId: string; familyId?: string; tokenHash: string; expiresAt: Date; ip?: string; userAgent?: string },
): Promise<SessionRow> {
  const row = await one<SessionRow>(
    q,
    `INSERT INTO user_sessions (user_id, family_id, refresh_token_hash, expires_at, ip, user_agent)
     VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4, $5, $6)
     RETURNING id, user_id, family_id, expires_at, revoked_at, revoked_reason`,
    [s.userId, s.familyId ?? null, s.tokenHash, s.expiresAt, s.ip ?? null, s.userAgent ?? null],
  );
  if (!row) throw new Error('session insert returned no row');
  return row;
}

export function findSessionByTokenHashForUpdate(q: Queryable, tokenHash: string): Promise<SessionRow | undefined> {
  return one<SessionRow>(
    q,
    `SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason
       FROM user_sessions WHERE refresh_token_hash = $1 FOR UPDATE`,
    [tokenHash],
  );
}

export async function revokeSession(q: Queryable, id: string, reason: string, replacedBy?: string): Promise<void> {
  await q.query(
    `UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, $2),
            replaced_by_session_id = COALESCE($3, replaced_by_session_id), last_used_at = now()
      WHERE id = $1`,
    [id, reason, replacedBy ?? null],
  );
}

export async function revokeFamily(q: Queryable, familyId: string, reason: string): Promise<number> {
  const res = await q.query(
    `UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
  return res.rowCount ?? 0;
}

export async function revokeAllForUser(q: Queryable, userId: string, reason: string): Promise<number> {
  const res = await q.query(
    `UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return res.rowCount ?? 0;
}
