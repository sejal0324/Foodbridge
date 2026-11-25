import { pino, type Logger } from 'pino';

/**
 * Paths that must never appear in logs. Matching is by exact path with
 * wildcards, so common nesting levels are listed explicitly.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  '*.password',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.code',
  '*.apiKey',
  '*.secret',
  '*.keySecret',
  '*.signature',
  '*.*.password',
  '*.*.token',
  '*.*.code',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    base: { service: 'foodbridge-backend' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}

export type { Logger };
