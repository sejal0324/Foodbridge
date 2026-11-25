import { expect, type Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:5098/api';
export const DEMO_PASSWORD = 'Demo-pass-2026';
export const ADMIN = { email: 'admin@foodbridge.local', password: 'Admin-pass-2026' };
export const ACCOUNTS = {
  spice: 'spice.garden@demo.foodbridge.local',
  sahyadri: 'hotel.sahyadri@demo.foodbridge.local',
  annapurna: 'annapurna.caterers@demo.foodbridge.local',
  helping: 'helping.hands@demo.foodbridge.local',
  rotibank: 'roti.bank@demo.foodbridge.local',
  delhiDonor: 'delhi.donor@demo.foodbridge.local',
  delhiNgo: 'delhi.ngo@demo.foodbridge.local',
  chennaiNgo: 'chennai.ngo@demo.foodbridge.local',
  greenLeaf: 'green.leaf@demo.foodbridge.local',
  sevaSadan: 'seva.sadan@demo.foodbridge.local',
  mumbaiDonor: 'mumbai.donor@demo.foodbridge.local',
  mumbaiNgo: 'mumbai.ngo@demo.foodbridge.local',
  bengaluruDonor: 'bengaluru.donor@demo.foodbridge.local',
  bengaluruNgo: 'bengaluru.ngo@demo.foodbridge.local',
};

/** Signs in through the real login form. */
export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Direct API calls used only to arrange state for the other party in a multi-role scenario. */
export async function apiAs(email: string, password = DEMO_PASSWORD) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = (await res.json()) as { data: { accessToken: string; user: { organization: { id: string } | null; representative: { id: string } | null } } };
  const token = body.data.accessToken;
  const call = async <T = any>(method: string, path: string, json?: unknown): Promise<{ status: number; body: T }> => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
  };
  return { call, user: body.data.user };
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** No uncaught page errors during a test (console 401 for anonymous refresh is expected and ignored). */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export type ApiSession = Awaited<ReturnType<typeof apiAs>>;

/** A short suffix so names created by one run never collide with seeded or earlier data. */
export const uniqueTag = () => Date.now().toString(36).slice(-6);

/** "₹1,234.50", formatted like the app (en-IN). */
export const inr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

/** A calendar date in IST as YYYY-MM-DD (the format of date inputs). */
export const istDate = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + offsetDays * 86_400_000));

export async function categoryId(code = 'COOKED_MEALS'): Promise<string> {
  const body = (await (await fetch(`${API}/food-categories`)).json()) as { data: { id: string; code: string }[] };
  const found = body.data.find((c) => c.code === code);
  if (!found) throw new Error(`food category ${code} not found`);
  return found.id;
}

/** The donor publishes a vegetarian cooked-meals donation through the API and returns its id. */
export async function createDonation(donor: ApiSession, foodName: string, quantity: number): Promise<string> {
  const res = await donor.call('POST', '/donations', {
    foodName,
    categoryId: await categoryId(),
    dietaryType: 'VEG',
    quantity,
    unit: 'MEALS',
    preparedAt: inMinutes(-20),
    storageType: 'HOT_HELD',
    pickupDeadline: inMinutes(240),
    safetyConfirmed: true,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/**
 * The donor's side of the pickup check through the API: verifies the representative's
 * QR pass, then confirms the photo-ID check.
 */
export async function donorVerifiesRepresentative(donor: ApiSession, pickupId: string, passToken: string) {
  const qr = await donor.call('POST', '/pickups/verify-qr', { token: passToken });
  expect(qr.status).toBe(200);
  const id = await donor.call('POST', '/pickups/confirm-identity', { pickupId });
  expect(id.status).toBe(200);
}
