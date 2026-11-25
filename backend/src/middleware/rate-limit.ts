import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { tooManyRequests } from '../utils/errors.js';

export interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Extra key material, e.g. the target email for login attempts. */
  key?: (req: Request) => string | undefined;
}

/**
 * In-memory rate limiter (single backend instance). QR passes are single-use
 * and expiring, enforced in PostgreSQL, which works across instances. A shared
 * store is required before running several instances (documented in
 * SECURITY.md).
 */
export function createLimiter(enabled: boolean, options: LimiterOptions): RequestHandler {
  if (!enabled) return (_req: Request, _res: Response, next: NextFunction) => next();
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const base = ipKeyGenerator(req.ip ?? 'unknown');
      const extra = options.key?.(req);
      return extra ? `${base}:${extra}` : base;
    },
    handler: (_req, _res, next) => next(tooManyRequests()),
  });
}
