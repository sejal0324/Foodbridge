import { isAxiosError } from 'axios';
import type { ApiErrorBody, ValidationIssue } from '@/types';

/**
 * Normalised API error. `message` comes from the backend envelope and is safe
 * to show to users; `requestId` helps support find the server log line.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level issues of a 422 VALIDATION_ERROR (empty otherwise). */
  get validationIssues(): ValidationIssue[] {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is ValidationIssue => typeof d === 'object' && d !== null && typeof (d as ValidationIssue).path === 'string' && typeof (d as ValidationIssue).message === 'string',
    );
  }

  /** A string value from `details` (e.g. `details.reason` of QR_REJECTED). */
  detail<T = unknown>(key: string): T | undefined {
    if (typeof this.details !== 'object' || this.details === null || Array.isArray(this.details)) return undefined;
    return (this.details as Record<string, unknown>)[key] as T | undefined;
  }

  static from(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (isAxiosError(err)) {
      const body = err.response?.data as Partial<ApiErrorBody> | undefined;
      if (err.response && body && typeof body === 'object' && body.error && typeof body.error.code === 'string') {
        return new ApiError(err.response.status, body.error.code, body.error.message || 'The request failed.', body.error.details, body.error.requestId);
      }
      if (err.response) {
        return new ApiError(err.response.status, `HTTP_${err.response.status}`, defaultMessageFor(err.response.status));
      }
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.');
      }
      if (err.code === 'ERR_CANCELED') return new ApiError(0, 'CANCELLED', 'The request was cancelled.');
      return new ApiError(0, 'NETWORK_ERROR', 'Could not reach FoodBridge. Check your connection and try again.');
    }
    if (err instanceof Error) return new ApiError(0, 'CLIENT_ERROR', err.message);
    return new ApiError(0, 'CLIENT_ERROR', 'Something went wrong.');
  }
}

function defaultMessageFor(status: number): string {
  if (status === 401) return 'Please sign in again.';
  if (status === 403) return 'You do not have permission to do this.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Please try again shortly.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return 'The request failed.';
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

/** User-facing message for any thrown value. */
export function errorMessage(err: unknown): string {
  return ApiError.from(err).message;
}
