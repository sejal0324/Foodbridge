import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, ok, type FakeRequest } from '../../tests/utils';
import { apiGet, apiPost, configureSessionHandlers } from './apiClient';
import { ApiError } from './apiError';
import { tokenStore } from './tokenStore';

const session = (token: string) => ({ user: { id: 'u1', role: 'DONOR' }, accessToken: token, accessTokenExpiresAt: '2026-11-03T12:00:00Z' });
const bearer = (r: FakeRequest) => String(r.headers.get('Authorization') ?? '');

describe('apiClient: access token, single-flight refresh and retry', () => {
  let restore: () => void = () => undefined;
  const onSessionExpired = vi.fn();
  const onRefreshed = vi.fn();

  beforeEach(() => {
    tokenStore.set('old-token');
    configureSessionHandlers({ onSessionExpired, onRefreshed });
    onSessionExpired.mockReset();
    onRefreshed.mockReset();
  });
  afterEach(() => {
    restore();
    tokenStore.clear();
    configureSessionHandlers({});
  });

  it('sends the in-memory access token as a Bearer header and unwraps { data }', async () => {
    const api = mockApi(() => ok({ hello: 'world' }));
    restore = api.restore;
    await expect(apiGet('/donors/me')).resolves.toEqual({ hello: 'world' });
    expect(bearer(api.calls[0] as FakeRequest)).toBe('Bearer old-token');
  });

  it('refreshes ONCE for concurrent TOKEN_EXPIRED responses, then retries each request once', async () => {
    let refreshes = 0;
    const api = mockApi(async (req) => {
      if (req.url === '/auth/refresh') {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return ok(session('new-token'));
      }
      if (bearer(req) === 'Bearer old-token') return apiError(401, 'TOKEN_EXPIRED', 'The access token has expired.');
      return ok({ url: req.url });
    });
    restore = api.restore;

    const results = await Promise.all([apiGet('/a'), apiGet('/b'), apiGet('/c')]);

    expect(results).toEqual([{ url: '/a' }, { url: '/b' }, { url: '/c' }]);
    expect(refreshes).toBe(1);
    expect(tokenStore.get()).toBe('new-token');
    expect(onRefreshed).toHaveBeenCalledTimes(1);
    // 3 original attempts + 1 refresh + 3 retries
    expect(api.calls).toHaveLength(7);
    const retries = api.calls.filter((c) => c.url !== '/auth/refresh' && bearer(c) === 'Bearer new-token');
    expect(retries.map((c) => c.url).sort()).toEqual(['/a', '/b', '/c']);
  });

  it('retries a request only once (no refresh loop if the retry is rejected again)', async () => {
    let refreshes = 0;
    const api = mockApi((req) => {
      if (req.url === '/auth/refresh') {
        refreshes += 1;
        return ok(session('new-token'));
      }
      return apiError(401, 'TOKEN_EXPIRED', 'The access token has expired.');
    });
    restore = api.restore;
    await expect(apiGet('/x')).rejects.toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
    expect(refreshes).toBe(1);
    expect(api.calls.filter((c) => c.url === '/x')).toHaveLength(2);
  });

  it('clears the session and notifies the app when the refresh fails', async () => {
    const api = mockApi((req) => {
      if (req.url === '/auth/refresh') return apiError(401, 'SESSION_REVOKED', 'This session has ended. Please sign in again.');
      return apiError(401, 'TOKEN_EXPIRED', 'The access token has expired.');
    });
    restore = api.restore;
    const error = await apiGet('/donations').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(tokenStore.get()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not end the session for business 401s such as a wrong current password', async () => {
    const api = mockApi(() => apiError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect.'));
    restore = api.restore;
    await expect(apiPost('/auth/change-password', { currentPassword: 'x', newPassword: 'y' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(tokenStore.get()).toBe('old-token');
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(1);
  });

  it('ends the session immediately when the server revokes it', async () => {
    const api = mockApi(() => apiError(401, 'SESSION_REVOKED', 'This session has ended.'));
    restore = api.restore;
    await expect(apiGet('/auth/me')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(tokenStore.get()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('normalises the error envelope (message, details, requestId)', async () => {
    const api = mockApi(() => apiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [{ path: 'foodName', message: 'Too short' }]));
    restore = api.restore;
    const e = (await apiPost('/donations', {}).catch((x: unknown) => x)) as ApiError;
    expect(e.message).toBe('The request is invalid.');
    expect(e.requestId).toBe('req-test-1');
    expect(e.validationIssues).toEqual([{ path: 'foodName', message: 'Too short' }]);
  });
});
