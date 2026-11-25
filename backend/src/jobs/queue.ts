import type { Queryable } from '../db/database.js';

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** Prevents enqueueing the same logical job twice (e.g. one match run per donation). */
  dedupeKey?: string;
}

/**
 * Enqueues a background job. Call inside the business transaction (transactional
 * outbox): if the transaction rolls back, the job disappears with it; if it
 * commits, the job is guaranteed to exist.
 */
export async function enqueueJob(
  q: Queryable,
  type: string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<number | null> {
  const res = await q.query<{ id: number }>(
    `INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [type, JSON.stringify(payload), options.runAt ?? null, options.maxAttempts ?? 5, options.dedupeKey ?? null],
  );
  return res.rows[0]?.id ?? null;
}
