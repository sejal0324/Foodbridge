import type { Queryable } from '../db/database.js';
import type { Actor } from '../types/auth.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Keys that must never be persisted in audit payloads. */
const SENSITIVE_KEY = /pass(word)?|token|secret|code|signature|authorization|cookie|api_?key/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

/**
 * Appends an audit record. Call it inside the same transaction as the change
 * it describes so that the audit trail and the data can never disagree.
 */
export async function recordAudit(q: Queryable, actor: Actor, entry: AuditEntry): Promise<void> {
  await q.query(
    `INSERT INTO audit_logs (actor_type, actor_user_id, actor_role, action, entity_type, entity_id, changes, metadata, request_id, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      actor.type,
      actor.userId,
      actor.role,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.changes ? JSON.stringify(redact(entry.changes)) : null,
      entry.metadata ? JSON.stringify(redact(entry.metadata)) : null,
      actor.requestId ?? null,
      actor.ip ?? null,
      actor.userAgent ?? null,
    ],
  );
}
