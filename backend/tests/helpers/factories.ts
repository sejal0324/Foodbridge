import { provisionAdmin } from '../../src/services/admin-provisioning.js';
import type { Harness } from './harness.js';

export const PASSWORD = 'Str0ng-pass-123';

/** Pune coordinates used across tests (Hinjewadi, Baner, Wakad, Kothrud). */
export const PLACES = {
  hinjewadi: { lat: 18.5913, lng: 73.7389 },
  wakad: { lat: 18.5987, lng: 73.7645 },
  baner: { lat: 18.559, lng: 73.7868 },
  kothrud: { lat: 18.5074, lng: 73.8077 },
  // ~80 km away, outside every radius used in tests.
  lonavala: { lat: 18.7546, lng: 73.4062 },
};

export interface Account {
  accessToken: string;
  refreshCookie: string;
  userId: string;
  orgId: string;
  email: string;
  auth: { Authorization: string };
}

let counter = 0;
const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}.${++counter}@example.org`;

function extractRefreshCookie(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = list.find((c) => c.startsWith('fb_refresh='));
  if (!cookie) throw new Error('no refresh cookie set');
  return cookie.split(';')[0] as string;
}

export async function registerDonor(
  h: Harness,
  opts: { name?: string; location?: { lat: number; lng: number }; phone?: string; email?: string } = {},
): Promise<Account> {
  const email = opts.email ?? uniqueEmail('donor');
  const res = await h.http
    .post('/api/auth/register')
    .send({
      accountType: 'DONOR',
      email,
      password: PASSWORD,
      fullName: 'Ravi Kulkarni',
      phone: opts.phone ?? '+919800000001',
      organization: { name: opts.name ?? 'Spice Garden', businessType: 'RESTAURANT', city: 'Pune', location: opts.location ?? PLACES.wakad },
    });
  if (res.status !== 201) throw new Error(`register donor failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body.data;
  return {
    accessToken: body.accessToken,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
    userId: body.user.id,
    orgId: body.user.organization.id,
    email,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

export async function registerNgo(
  h: Harness,
  opts: { name?: string; location?: { lat: number; lng: number }; phone?: string; email?: string } = {},
): Promise<Account> {
  const email = opts.email ?? uniqueEmail('ngo');
  const res = await h.http
    .post('/api/auth/register')
    .send({
      accountType: 'NGO',
      email,
      password: PASSWORD,
      fullName: 'Meera Joshi',
      phone: opts.phone ?? '+919800000002',
      organization: { name: opts.name ?? 'Helping Hands', city: 'Pune', location: opts.location ?? PLACES.hinjewadi },
    });
  if (res.status !== 201) throw new Error(`register ngo failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body.data;
  return {
    accessToken: body.accessToken,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
    userId: body.user.id,
    orgId: body.user.organization.id,
    email,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

export async function createAdmin(h: Harness): Promise<Account> {
  const email = uniqueEmail('admin');
  await provisionAdmin(h.ctx.db, { email, fullName: 'Asha Admin', password: PASSWORD });
  const res = await h.http.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  return {
    accessToken: res.body.data.accessToken,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
    userId: res.body.data.user.id,
    orgId: '',
    email,
    auth: { Authorization: `Bearer ${res.body.data.accessToken}` },
  };
}

export async function approve(h: Harness, admin: Account, type: 'donor' | 'ngo', orgId: string): Promise<void> {
  const res = await h.http
    .patch(`/api/admin/organizations/${type}/${orgId}/verification`)
    .set(admin.auth)
    .send({ status: 'APPROVED', notes: 'Documents verified' });
  if (res.status !== 204) throw new Error(`approve failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function categoryId(h: Harness, code = 'COOKED_MEALS'): Promise<string> {
  const res = await h.ctx.db.query<{ id: string }>('SELECT id FROM food_categories WHERE code = $1', [code]);
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`category ${code} missing`);
  return id;
}

/** Approved donor + approved NGO accepting cooked meals, ready for workflow tests. */
export async function approvedPair(h: Harness, admin?: Account) {
  const a = admin ?? (await createAdmin(h));
  const donor = await registerDonor(h);
  const ngo = await registerNgo(h);
  await approve(h, a, 'donor', donor.orgId);
  await approve(h, a, 'ngo', ngo.orgId);
  const cooked = await categoryId(h);
  await h.http.put('/api/ngos/me/food-preferences').set(ngo.auth).send({ categoryIds: [cooked] }).expect(200);
  await h.http.put('/api/donors/me/categories').set(donor.auth).send({ categoryIds: [cooked] }).expect(200);
  return { admin: a, donor, ngo, cooked };
}
