import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { apiClient, authClient } from '@/services/apiClient';
import type { Me } from '@/types';

export const donorUser: Me = {
  id: 'u-donor',
  email: 'spice.garden@demo.foodbridge.local',
  fullName: 'Ravi Kulkarni',
  phone: '+919800000101',
  role: 'DONOR',
  accountStatus: 'ACTIVE',
  adminLevel: null,
  organization: { type: 'DONOR', id: 'd1', name: 'Spice Garden Restaurant', verificationStatus: 'APPROVED' },
  representative: null,
};

export function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    user: donorUser,
    login: vi.fn(),
    register: vi.fn(),
    acceptInvite: vi.fn(),
    logout: vi.fn(),
    reloadUser: vi.fn(),
    ...overrides,
  };
}

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export function renderWithProviders(ui: ReactElement, { route = '/', auth = authValue(), ...options }: { route?: string; auth?: AuthContextValue } & Omit<RenderOptions, 'wrapper'> = {}) {
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

// ---------------------------------------------------------------------------
// Fake HTTP: route requests to a handler instead of the network.
// ---------------------------------------------------------------------------
export interface FakeRequest {
  method: string;
  url: string;
  body: unknown;
  headers: AxiosHeaders;
  params: unknown;
}
export type FakeReply = { status: number; data?: unknown; headers?: Record<string, string> };
export type FakeHandler = (req: FakeRequest) => FakeReply | Promise<FakeReply>;

function adapterFor(handler: FakeHandler, calls: FakeRequest[]): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
    // Copy: interceptors may mutate the same headers object on retry.
    const headers = new AxiosHeaders(AxiosHeaders.from(config.headers).toJSON() as Record<string, string>);
    const body = typeof config.data === 'string' && config.data ? JSON.parse(config.data) : config.data;
    const req: FakeRequest = { method: (config.method ?? 'get').toUpperCase(), url: config.url ?? '', body, headers, params: config.params };
    calls.push(req);
    const reply = await handler(req);
    const response: AxiosResponse = { data: reply.data ?? '', status: reply.status, statusText: String(reply.status), headers: reply.headers ?? {}, config };
    if (reply.status >= 200 && reply.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${reply.status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
  };
}

/** Installs a fake backend on both API clients. Returns the recorded calls and a restore function. */
export function mockApi(handler: FakeHandler) {
  const calls: FakeRequest[] = [];
  const original = { api: apiClient.defaults.adapter, auth: authClient.defaults.adapter };
  apiClient.defaults.adapter = adapterFor(handler, calls);
  authClient.defaults.adapter = adapterFor(handler, calls);
  return {
    calls,
    restore: () => {
      apiClient.defaults.adapter = original.api;
      authClient.defaults.adapter = original.auth;
    },
  };
}

export const ok = (data: unknown, extra: Record<string, unknown> = {}): FakeReply => ({ status: 200, data: { data, ...extra } });
export const apiError = (status: number, code: string, message: string, details?: unknown): FakeReply => ({
  status,
  data: { error: { code, message, ...(details !== undefined ? { details } : {}), requestId: 'req-test-1' } },
});
