import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Database } from '../db/database.js';
import { one } from '../db/database.js';
import { sha256Hex, stableStringify } from '../utils/crypto.js';
import { AppError, conflict, unprocessable } from '../utils/errors.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
const TTL_HOURS = 24;

/**
 * Optional `Idempotency-Key` support for state-creating POST requests. The
 * first request with a key stores its response; retries with the same key
 * and body replay it; the same key with a different body is rejected (422);
 * a retry while the first is still running gets 409. 5xx responses release the
 * key so the client can retry.
 */
export function idempotent(db: Database, scope: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header('idempotency-key');
    if (!key) return next();
    if (!KEY_PATTERN.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-200 characters [A-Za-z0-9_-].');
    const userId = req.auth?.userId ?? null;
    const scopedKey = `${userId ?? 'anon'}:${key}`;
    const requestHash = sha256Hex(stableStringify({ params: req.params, body: req.body ?? null }));

    const inserted = await one<{ id: string }>(
      db,
      `INSERT INTO idempotency_records (scope, key, user_id, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now() + make_interval(hours => $5))
       ON CONFLICT (scope, key) DO NOTHING RETURNING id`,
      [scope, scopedKey, userId, requestHash, TTL_HOURS],
    );
    if (!inserted) {
      const existing = await one<{ request_hash: string; status: string; response_status: number | null; response_body: unknown }>(
        db,
        'SELECT request_hash, status, response_status, response_body FROM idempotency_records WHERE scope = $1 AND key = $2',
        [scope, scopedKey],
      );
      if (!existing) return next();
      if (existing.request_hash !== requestHash) {
        throw unprocessable('This Idempotency-Key was already used with a different request.', 'IDEMPOTENCY_KEY_REUSED');
      }
      if (existing.status === 'IN_PROGRESS') throw conflict('The original request is still being processed.', 'REQUEST_IN_PROGRESS');
      res.setHeader('Idempotent-Replayed', 'true');
      return res.status(existing.response_status ?? 200).json(existing.response_body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      const persist =
        status >= 500
          ? db.query('DELETE FROM idempotency_records WHERE scope = $1 AND key = $2', [scope, scopedKey])
          : db.query(
              `UPDATE idempotency_records SET status = 'COMPLETED', response_status = $3, response_body = $4 WHERE scope = $1 AND key = $2`,
              [scope, scopedKey, status, JSON.stringify(body)],
            );
      // Persist the outcome before the client sees the response, so an immediate retry replays it.
      void persist.catch(() => undefined).finally(() => originalJson(body));
      return res;
    };
    next();
  };
}
