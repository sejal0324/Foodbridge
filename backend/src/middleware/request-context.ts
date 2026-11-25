import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Actor, AuthContext } from '../types/auth.js';
import { unauthorized } from '../utils/errors.js';

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns a request id (accepting a well-formed incoming X-Request-Id) and echoes it. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Returns the authenticated identity or throws 401 (use after `authenticate`). */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function actorFrom(req: Request): Actor {
  return {
    type: 'USER',
    userId: req.auth?.userId ?? null,
    role: req.auth?.role ?? null,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.header('user-agent')?.slice(0, 300),
  };
}
