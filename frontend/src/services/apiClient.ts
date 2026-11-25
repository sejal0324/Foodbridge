import axios, { AxiosHeaders, type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiEnvelope, Paginated, SessionResponse } from '@/types';
import { ApiError } from './apiError';
import { API_BASE_URL } from './config';
import { tokenStore } from './tokenStore';

/**
 * HTTP client for the FoodBridge API.
 *
 * - Sends the in-memory access token as `Authorization: Bearer …`.
 * - On 401 TOKEN_EXPIRED it performs ONE shared ("single-flight") refresh via
 *   the httpOnly cookie, then retries the original request once.
 * - If the refresh fails, the session is cleared and `onSessionExpired` runs
 *   (the auth provider then routes to /login).
 * - Errors are thrown as `ApiError` (status, code, message, details, requestId).
 */
export interface ApiRequestConfig extends AxiosRequestConfig {
  /** Do not attempt a token refresh on 401 (used by auth endpoints). */
  skipAuthRefresh?: boolean;
}

interface InternalConfig extends InternalAxiosRequestConfig {
  skipAuthRefresh?: boolean;
  _retried?: boolean;
  _sentToken?: string | null;
}

export interface SessionHandlers {
  onRefreshed?: (session: SessionResponse) => void;
  onSessionExpired?: (reason: ApiError) => void;
}

/** 401 codes meaning the session itself is gone (not a wrong password etc.). */
const SESSION_ENDING_CODES = new Set(['INVALID_TOKEN', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_STALE']);

let handlers: SessionHandlers = {};
let refreshPromise: Promise<SessionResponse> | null = null;

/** Main client (with interceptors). */
export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true, timeout: 30_000 });

/** Bare client for /auth/refresh (no interceptors, so a failed refresh cannot recurse). */
export const authClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true, timeout: 20_000 });

export function configureSessionHandlers(next: SessionHandlers): void {
  handlers = next;
}

/**
 * Refreshes the session using the refresh cookie. Concurrent callers share a
 * single in-flight request, so the rotating refresh token is used exactly once.
 */
export function refreshSession(): Promise<SessionResponse> {
  if (!refreshPromise) {
    refreshPromise = authClient
      .post<ApiEnvelope<SessionResponse>>('/auth/refresh', null)
      .then((res) => {
        const session = res.data.data;
        tokenStore.set(session.accessToken);
        handlers.onRefreshed?.(session);
        return session;
      })
      .catch((err: unknown) => {
        throw ApiError.from(err);
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Clears the in-memory session and notifies the auth layer. */
export function expireSession(reason: ApiError): void {
  const hadSession = tokenStore.get() !== null;
  tokenStore.clear();
  if (hadSession) handlers.onSessionExpired?.(reason);
}

apiClient.interceptors.request.use((config: InternalConfig) => {
  const token = tokenStore.get();
  config._sentToken = token;
  if (token && !config.headers.has('Authorization')) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

async function parseBlobError(error: AxiosError): Promise<void> {
  const data = error.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob && /json/i.test(data.type)) {
    try {
      (error.response as { data: unknown }).data = JSON.parse(await data.text());
    } catch {
      /* keep the blob */
    }
  }
}

apiClient.interceptors.response.use(undefined, async (error: AxiosError) => {
  await parseBlobError(error);
  const apiError = ApiError.from(error);
  const config = error.config as InternalConfig | undefined;

  if (apiError.status === 401 && apiError.code === 'TOKEN_EXPIRED' && config && !config._retried && !config.skipAuthRefresh) {
    config._retried = true;
    const current = tokenStore.get();
    let token: string;
    if (current && config._sentToken && current !== config._sentToken) {
      // Another request already refreshed while this one was in flight.
      token = current;
    } else {
      try {
        token = (await refreshSession()).accessToken;
      } catch (refreshError) {
        expireSession(ApiError.from(refreshError));
        throw apiError;
      }
    }
    const headers = AxiosHeaders.from(config.headers);
    headers.set('Authorization', `Bearer ${token}`);
    config.headers = headers;
    return apiClient.request(config);
  }

  if (apiError.status === 401 && SESSION_ENDING_CODES.has(apiError.code) && config?._sentToken) {
    expireSession(apiError);
  }
  throw apiError;
});

// ---------------------------------------------------------------------------
// Envelope helpers: return `data` (or items + meta) directly.
// ---------------------------------------------------------------------------
export async function apiGet<T>(url: string, params?: object, config?: ApiRequestConfig): Promise<T> {
  const res = await apiClient.get<ApiEnvelope<T>>(url, { ...config, params });
  return res.data.data;
}

export async function apiGetPage<T>(url: string, params?: object, config?: ApiRequestConfig): Promise<Paginated<T>> {
  const res = await apiClient.get<ApiEnvelope<T[]>>(url, { ...config, params });
  const items = res.data.data;
  return { items, meta: res.data.meta ?? { page: 1, pageSize: items.length, total: items.length } };
}

async function send<T>(method: 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown, config?: ApiRequestConfig): Promise<T> {
  const res = await apiClient.request<ApiEnvelope<T> | ''>({ ...config, method, url, data: body });
  // 204 No Content has no envelope.
  if (res.status === 204 || res.data === '' || res.data === undefined || res.data === null) return undefined as T;
  return (res.data as ApiEnvelope<T>).data;
}

export const apiPost = <T = void>(url: string, body?: unknown, config?: ApiRequestConfig) => send<T>('post', url, body, config);
export const apiPatch = <T = void>(url: string, body?: unknown, config?: ApiRequestConfig) => send<T>('patch', url, body, config);
export const apiPut = <T = void>(url: string, body?: unknown, config?: ApiRequestConfig) => send<T>('put', url, body, config);
export const apiDelete = <T = void>(url: string, config?: ApiRequestConfig) => send<T>('delete', url, undefined, config);

/** Authenticated binary download (PDFs, documents, photos). */
export async function apiGetBlob(url: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await apiClient.get<Blob>(url, { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return { blob: res.data, filename: match?.[1] ? decodeURIComponent(match[1]) : null };
}

/** A fresh Idempotency-Key for one submit attempt of a state-creating POST. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
