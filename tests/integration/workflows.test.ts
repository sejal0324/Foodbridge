import { beforeAll, describe, expect, it } from 'vitest';
import { adminSession, api, approve, categoryId, inMinutes, register, waitFor, type Session } from './helpers.js';

/**
 * End-to-end workflows through the real stack: Express API → PostgreSQL/PostGIS
 * → background worker → Python AI service (real ranking and optimisation).
 */
let admin: Session;
let cooked: string;
const HINJEWADI = { lat: 18.5913, lng: 73.7389 };
const WAKAD = { lat: 18.5987, lng: 73.7645 };
const BANER = { lat: 18.559, lng: 73.7868 };

beforeAll(async () => {
  admin = await adminSession();
  cooked = await categoryId();
});

async function setupNgo(name: string, location = HINJEWADI, phone = '+919811110001') {
  const ngo = await register('NGO', name, location, phone);
  await approve(admin, 'ngo', ngo.orgId);
  await api('PUT', '/ngos/me/food-preferences', { token: ngo.token, body: { categoryIds: [cooked] } });
  return ngo;
}

async function setupDonor(name: string, location = WAKAD) {
  const donor = await register('DONOR', name, location, '+919822220001');
  await approve(admin, 'donor', donor.orgId);
  await api('PUT', '/donors/me/categories', { token: donor.token, body: { categoryIds: [cooked] } });
  return donor;
}

describe('Scenario A: donor-initiated donation through verified handover, rewards and billing', () => {
  it('runs end to end with real AI ranking', async () => {
    const donor = await setupDonor('Integration Restaurant');
    const ngo = await setupNgo('Integration NGO', HINJEWADI, '+919811119001');
    const donation = await api('POST', '/donations', {
      token: donor.token,
      body: { foodName: 'Veg pulao', categoryId: cooked, dietaryType: 'VEG', quantity: 80, unit: 'MEALS', preparedAt: inMinutes(-20), storageType: 'HOT_HELD', pickupDeadline: inMinutes(240), safetyConfirmed: true },
    });
    expect(donation.status).toBe(201);
    const id = donation.body.data.id;

    // The background worker runs matching through the real AI service.
    const recs = await waitFor(async () => {
      const r = await api('GET', `/matching/ngos?donationId=${id}`, { token: donor.token });
      return r.body.data.runId ? r.body.data : undefined;
    });
    expect(recs.rankingStatus).toBe('RANKED');
    const mine = recs.items.find((i: { candidate: { id: string } }) => i.candidate.id === ngo.orgId);
    expect(mine.eligible).toBe(true);
    expect(mine.score).toBeGreaterThan(0);
    expect(Object.keys(mine.criteria)).toHaveLength(8);
    expect(mine.explanation).toMatch(/recommended because/);

    const notifications = await api('GET', '/notifications', { token: ngo.token });
    expect(notifications.body.data.some((n: { type: string }) => n.type === 'DONATION_MATCH')).toBe(true);

    const request = await api('POST', `/donations/${id}/requests`, { token: ngo.token, body: { quantity: 40 } });
    expect(request.body.data.feeEstimate.baseAmount).toBe(200);
    const approved = await api('PATCH', `/requests/${request.body.data.id}/approve`, { token: donor.token, body: {} });
    expect(approved.status).toBe(200);

    const rep = await api('POST', '/ngos/me/representatives', { token: ngo.token, body: { self: true, phone: '+919811119001', idDocumentType: 'AADHAAR', idDocumentLast4: '9001' } });
    const pickup = await api('POST', '/pickups/assign', { token: ngo.token, body: { allocationId: approved.body.data.allocationId, representativeId: rep.body.data.id } });
    expect(pickup.status).toBe(201);
    const pass = await api('POST', '/pickups/generate-pass', { token: ngo.token, body: { pickupId: pickup.body.data.id } });
    const qr = await api('POST', '/pickups/verify-qr', { token: donor.token, body: { token: pass.body.data.token } });
    expect(qr.status).toBe(200);
    expect(qr.body.data.pickup.checks.qrVerifiedAt).toBeTruthy();
    const identity = await api('POST', '/pickups/confirm-identity', { token: donor.token, body: { pickupId: pickup.body.data.id } });
    expect(identity.body.data.status).toBe('VERIFIED');
    await api('POST', '/pickups/confirm-handover', { token: donor.token, body: { pickupId: pickup.body.data.id, quantity: 40 } });
    const handover = await api('POST', '/pickups/confirm-handover', { token: ngo.token, body: { pickupId: pickup.body.data.id, quantity: 40 } });
    expect(handover.body.data.outcome).toBe('CONFIRMED');

    const delivered = await api('POST', `/pickups/${pickup.body.data.id}/confirm-delivery`, { token: ngo.token, body: { deliveredQuantity: 40, beneficiariesServed: 40 } });
    expect(delivered.body.data.status).toBe('DELIVERED');
    const balance = await api('GET', '/rewards/balance', { token: donor.token });
    expect(balance.body.data).toMatchObject({ balance: 400, lifetimeMeals: 40 });
    const billing = await api('GET', '/billing/summary', { token: ngo.token });
    expect(billing.body.data.uninvoicedAmount).toBe(200);
  });
});

describe('Scenario B: NGO-initiated request filled by several donors', () => {
  it('matches donors with the real AI service and reaches FULFILLED from partial offers', async () => {
    const ngo = await setupNgo('Integration Shelter', HINJEWADI, '+919811119002');
    const donors = [await setupDonor('Donor A', WAKAD), await setupDonor('Donor B', BANER), await setupDonor('Donor C', HINJEWADI)];
    const neededFrom = inMinutes(24 * 60);
    const created = await api('POST', '/assistance-requests', {
      token: ngo.token,
      body: { categoryId: cooked, dietaryRequirement: 'VEG_ONLY', quantityRequired: 150, unit: 'MEALS', neededFrom, neededUntil: inMinutes(26 * 60), urgency: 'HIGH', beneficiariesCount: 150 },
    });
    const rid = created.body.data.id;
    const recs = await waitFor(async () => {
      const r = await api('GET', `/matching/donors?requestId=${rid}`, { token: ngo.token });
      return r.body.data.runId ? r.body.data : undefined;
    });
    expect(recs.rankingStatus).toBe('RANKED');
    expect(recs.items.filter((i: { eligible: boolean }) => i.eligible).length).toBeGreaterThanOrEqual(3);

    const quantities = [50, 60, 40];
    for (const [i, d] of donors.entries()) {
      const o = await api('POST', `/assistance-requests/${rid}/offers`, {
        token: d.token,
        body: { quantity: quantities[i], foodName: 'Veg thali', dietaryType: 'VEG', pickupAvailableFrom: inMinutes(20 * 60), pickupDeadline: inMinutes(25 * 60) },
      });
      expect(o.status).toBe(201);
      const accepted = await api('PATCH', `/offers/${o.body.data.id}/accept`, { token: ngo.token, body: {} });
      expect(accepted.status).toBe(200);
    }
    const request = await api('GET', `/assistance-requests/${rid}`, { token: ngo.token });
    expect(request.body.data).toMatchObject({ status: 'FULFILLED', quantityCommitted: 150, quantityRemaining: 0 });
    expect(request.body.data.offers.filter((o: { status: string }) => o.status === 'ACCEPTED')).toHaveLength(3);
  });
});

describe('Scenario C: unauthorised pickup attempt', () => {
  it('rejects a forged QR, blocks handover and leaves an audit trail', async () => {
    const forged = await api('POST', '/pickups/verify-qr', { token: (await setupDonor('Scenario C Donor')).token, body: { token: 'FBP1.forged-token-from-someone-else' } });
    expect(forged.status).toBe(422);
    expect(forged.body.error.details.reason).toBe('TOKEN_NOT_FOUND');
    const logs = await api('GET', '/admin/verification-logs', { token: admin.token });
    expect(logs.body.data.some((l: { failureReason: string }) => l.failureReason === 'TOKEN_NOT_FOUND')).toBe(true);
    const audit = await api('GET', '/admin/audit-logs?action=pickup.qr_rejected', { token: admin.token });
    expect(audit.body.data.length).toBeGreaterThan(0);
  });
});

describe('Scenario D: concurrent reservations of the last units', () => {
  it('reserves only what exists when many NGOs approve at once', async () => {
    const donor = await setupDonor('Scenario D Donor');
    const donation = await api('POST', '/donations', {
      token: donor.token,
      body: { foodName: 'Last plates', categoryId: cooked, dietaryType: 'VEG', quantity: 30, unit: 'MEALS', preparedAt: inMinutes(-10), storageType: 'HOT_HELD', pickupDeadline: inMinutes(180), safetyConfirmed: true },
    });
    const ngos = await Promise.all([1, 2, 3, 4].map((i) => setupNgo(`Racer ${i}`, HINJEWADI, `+91981111900${i + 2}`)));
    const requests = await Promise.all(ngos.map((n) => api('POST', `/donations/${donation.body.data.id}/requests`, { token: n.token, body: { quantity: 10 } })));
    const results = await Promise.all(requests.map((r) => api('PATCH', `/requests/${r.body.data.id}/approve`, { token: donor.token, body: {} })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const d = await api('GET', `/donations/${donation.body.data.id}`, { token: donor.token });
    expect(d.body.data).toMatchObject({ reservedQuantity: 30, availableQuantity: 0, status: 'RESERVED' });
  });
});

describe('Forecasting with the real model', () => {
  it('produces a labelled forecast from donor history', async () => {
    const donor = await setupDonor('Forecast Donor');
    for (let i = 1; i <= 20; i++) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      await api('POST', '/donors/me/metrics', { token: donor.token, body: { date, mealPeriod: 'LUNCH', preparedQty: 200, soldQty: 170 + (i % 5), surplusQty: 30 - (i % 5) } });
    }
    const f = await api('GET', '/predictions/surplus', { token: donor.token });
    expect(f.body.data.status).toBe('OK');
    expect(f.body.data.model.trainingDataLabel).toBe('SYNTHETIC');
    const lunch = f.body.data.predictions.find((p: { mealPeriod: string }) => p.mealPeriod === 'LUNCH');
    expect(lunch.status).toBe('OK');
    expect(lunch.predictedQuantity).toBeGreaterThanOrEqual(0);
    expect(f.body.data.dataLabel).toBe('REAL');
  });
});
