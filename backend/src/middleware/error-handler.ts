import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import type { Logger } from '../config/logger.js';
import { AppError, fromPgError } from '../utils/errors.js';
import { formatZodIssues } from '../validators/common.js';

interface BodyParserError {
  type?: string;
  status?: number;
}

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new AppError(422, 'VALIDATION_ERROR', 'The request is invalid.', formatZodIssues(err));
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new AppError(413, 'FILE_TOO_LARGE', 'The uploaded file is too large.');
    return new AppError(400, 'UPLOAD_ERROR', 'The upload could not be processed.');
  }
  const bp = err as BodyParserError;
  if (bp?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  if (bp?.type === 'entity.parse.failed') return new AppError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
  return fromPgError(err);
}

/** Central error handler: consistent envelope, no stack traces or internals leaked. */
export function errorHandler(logger: Logger) {
  // Express identifies error middleware by its four-argument signature.
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const appError = toAppError(err);
    const requestId = req.requestId;
    if (appError) {
      if (appError.status >= 500) logger.error({ err, requestId, code: appError.code }, 'request failed');
      else logger.debug({ requestId, code: appError.code }, 'request rejected');
      res.status(appError.status).json({
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details !== undefined ? { details: appError.details } : {}),
          requestId,
        },
      });
      return;
    }
    logger.error({ err, requestId }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
    });
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}.`, requestId: req.requestId },
  });
}
