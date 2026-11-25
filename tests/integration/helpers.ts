
export const API = process.env.API_URL ?? 'http://127.0.0.1:5099/api';
export const AI = process.env.AI_URL ?? 'http://127.0.0.1:8011';
export const AI_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? '';
export const PASSWORD = 'Integration-pass-1';

export interface Session {
  token: string;
  userId: string;
  orgId: string;
  email: string;
}

export async function api<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

export async function ai<T = any>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${AI}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${AI_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

let n = 0;
export const uniqueEmail = (p: string) => `${p}.${Date.now()}.${++n}@integration.test`;

export async function login(email: string, password: string): Promise<Session> {
  const r = await api('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.data.accessToken, userId: r.body.data.user.id, orgId: r.body.data.user.organization?.id ?? '', email };
}

export async function register(type: 'DONOR' | 'NGO', name: string, location: { lat: number; lng: number }, phone: string): Promise<Session> {
  const email = uniqueEmail(type.toLowerCase());
  const r = await api('POST', '/auth/register', {
    body: { accountType: type, email, password: PASSWORD, fullName: `${name} Owner`, phone, organization: { name, city: 'Pune', addressLine: `${name} Road`, location } },
  });
  if (r.status !== 201) throw new Error(`register → ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.data.accessToken, userId: r.body.data.user.id, orgId: r.body.data.user.organization.id, email };
}

export const adminSession = () => login(process.env.ADMIN_EMAIL as string, process.env.ADMIN_PASSWORD as string);

export async function approve(admin: Session, type: 'donor' | 'ngo', id: string) {
  const r = await api('PATCH', `/admin/organizations/${type}/${id}/verification`, { token: admin.token, body: { status: 'APPROVED', notes: 'integration' } });
  if (r.status !== 204) throw new Error(`approve → ${r.status}`);
}

export async function categoryId(code = 'COOKED_MEALS'): Promise<string> {
  const r = await api('GET', '/food-categories');
  return r.body.data.find((c: { code: string }) => c.code === code).id;
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('condition not met in time');
}
