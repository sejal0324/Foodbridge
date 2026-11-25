/**
 * Application error with an HTTP status and a stable machine-readable code.
 * Messages are safe to show to end users; never put secrets in them.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(400, code, message, details);
export const validationError = (details: unknown, message = 'The request is invalid.') =>
  new AppError(422, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Authentication is required.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action.', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource', code = 'NOT_FOUND') => new AppError(404, code, `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new AppError(409, code, message, details);
export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new AppError(422, code, message, details);
export const tooManyRequests = (message = 'Too many requests. Please try again later.', code = 'RATE_LIMITED') =>
  new AppError(429, code, message);
export const serviceUnavailable = (message: string, code = 'SERVICE_UNAVAILABLE') =>
  new AppError(503, code, message);

interface PgLikeError {
  code?: string;
  constraint?: string;
}

/** Maps known PostgreSQL constraint violations to safe API errors. */
export function fromPgError(err: unknown): AppError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as PgLikeError;
  switch (e.code) {
    case '23505':
      return conflict('This record already exists or conflicts with an existing one.', 'DUPLICATE', {
        constraint: e.constraint,
      });
    case '23514':
      return conflict('The change violates a business rule.', 'CONSTRAINT_VIOLATION', { constraint: e.constraint });
    case '23503':
      return conflict('A referenced record does not exist or is still in use.', 'REFERENCE_VIOLATION', {
        constraint: e.constraint,
      });
    case '22P02':
      return badRequest('A value has an invalid format.', undefined, 'INVALID_FORMAT');
    case '40001':
    case '40P01':
      return conflict('The operation conflicted with a concurrent change. Please retry.', 'CONCURRENT_UPDATE');
    case '57014':
      return serviceUnavailable('The database took too long to respond.', 'DATABASE_TIMEOUT');
    case 'ECONNREFUSED':
    case '57P01':
    case '57P03':
    case '08006':
    case '08001':
      return serviceUnavailable('The database is unavailable. Please try again shortly.', 'DATABASE_UNAVAILABLE');
    default:
      return undefined;
  }
}
