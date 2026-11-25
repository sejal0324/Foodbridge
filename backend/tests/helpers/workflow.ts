import type { Account } from './factories.js';
import type { Harness } from './harness.js';

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function createDonation(
  h: Harness,
  donor: Account,
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number; warnings: string[] }> {
  const res = await h.http
    .post('/api/donations')
    .set(donor.auth)
    .send({
      foodName: 'Veg biryani',
      categoryId,
      dietaryType: 'VEG',
      quantity: 100,
      unit: 'MEALS',
      preparedAt: inMinutes(-30),
      storageType: 'HOT_HELD',
      pickupDeadline: inMinutes(240),
      address: 'Wakad Road, Pune',
      safetyConfirmed: true,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`create donation failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function requestDonation(h: Harness, ngo: Account, donationId: string, quantity: number): Promise<string> {
  const res = await h.http.post(`/api/donations/${donationId}/requests`).set(ngo.auth).send({ quantity, message: 'For our evening meal' });
  if (res.status !== 201) throw new Error(`request failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function createAssistanceRequest(h: Harness, ngo: Account, categoryId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await h.http
    .post('/api/assistance-requests')
    .set(ngo.auth)
    .send({
      categoryId,
      dietaryRequirement: 'VEG_ONLY',
      quantityRequired: 150,
      unit: 'MEALS',
      neededFrom: inMinutes(24 * 60),
      neededUntil: inMinutes(26 * 60),
      address: 'Hinjewadi Phase 1, Pune',
      urgency: 'HIGH',
      beneficiariesCount: 150,
      reason: 'Community kitchen lunch',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`create assistance failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function offer(h: Harness, donor: Account, requestId: string, quantity: number, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await h.http
    .post(`/api/assistance-requests/${requestId}/offers`)
    .set(donor.auth)
    .send({
      quantity,
      foodName: 'Dal rice',
      dietaryType: 'VEG',
      pickupAvailableFrom: inMinutes(20 * 60),
      pickupDeadline: inMinutes(25 * 60),
      address: 'Baner Road, Pune',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`offer failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function donationRow(h: Harness, id: string) {
  return (await h.ctx.db.query<{ status: string; quantity: number; reserved_quantity: number }>('SELECT status, quantity, reserved_quantity FROM donations WHERE id = $1', [id])).rows[0];
}
