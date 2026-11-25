import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../src/types/auth.js';
import { approve, registerDonor } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { confirmBoth, pickupFixture, verifyPickup } from './helpers/pickup.js';
import { createDonation, requestDonation } from './helpers/workflow.js';

let h: Harness;
beforeEach(async () => {
  h ??= await createHarness();
  await resetDatabase(h.ctx.db);
});
afterAll(() => h.close());

const balance = async (donorId: string) =>
  (await h.ctx.db.query<{ balance: number; lifetime_meals: number }>('SELECT balance, lifetime_meals FROM reward_balances WHERE donor_id = $1', [donorId])).rows[0];
const verificationReasons = async () =>
  (await h.ctx.db.query<{ failure_reason: string | null; result: string }>('SELECT result, failure_reason FROM pickup_verifications ORDER BY id')).rows;

describe('Scenario A: verified pickup → handover → rewards and billing → delivery', () => {
  it('completes the whole collection with two-way confirmation, 10 points/meal and ₹5/meal', async () => {
    const f = await pickupFixture(h, { approve: 40 });
    const pass = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(200);
    expect(pass.body.data.token).toMatch(/^FBP1\./);
    // The token is stored only as a hash.
    const stored = await h.ctx.db.query('SELECT token_hash FROM pickup_tokens');
    expect(stored.rows[0]?.token_hash).not.toContain(pass.body.data.token);

    const qr = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass.body.data.token }).expect(200);
    expect(Object.keys(qr.body.data)).toEqual(['pickup']); // no OTP step follows the scan
    expect(qr.body.data.pickup.checks).toEqual({ qrVerifiedAt: expect.any(String), identityConfirmedAt: null });
    expect(qr.body.data.pickup.status).toBe('ASSIGNED');
    expect(qr.body.data.pickup.representative.idDocumentLast4).toBe('4321');
    expect(qr.body.data.pickup.representative.phone).toMatch(/•/); // masked for the donor

    await h.http.post('/api/pickups/confirm-handover').set(f.donor.auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(409); // not verified yet
    const verified = await h.http.post('/api/pickups/confirm-identity').set(f.donor.auth).send({ pickupId: f.pickupId }).expect(200);
    expect(verified.body.data.status).toBe('VERIFIED');
    expect(verified.body.data.checks.identityConfirmedAt).toEqual(expect.any(String));
    const methods = await h.ctx.db.query<{ method: string; result: string }>('SELECT method, result FROM pickup_verifications ORDER BY id');
    expect(methods.rows).toEqual([{ method: 'QR', result: 'SUCCESS' }, { method: 'IDENTITY_CHECK', result: 'SUCCESS' }]);

    const first = await h.http.post('/api/pickups/confirm-handover').set(f.donor.auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(200);
    expect(first.body.data.outcome).toBe('WAITING');
    expect(await balance(f.donor.orgId)).toBeUndefined(); // no points before the NGO confirms
    const second = await h.http.post('/api/pickups/confirm-handover').set(f.ngo.auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(200);
    expect(second.body.data.outcome).toBe('CONFIRMED');

    expect(await balance(f.donor.orgId)).toMatchObject({ balance: 400, lifetime_meals: 40 });
    const fee = await h.ctx.db.query('SELECT billable_quantity, base_amount, tax_amount, total_amount, status FROM ngo_billing');
    expect(fee.rows).toEqual([{ billable_quantity: 40, base_amount: 200, tax_amount: 0, total_amount: 200, status: 'PENDING' }]);
    const donorBilling = await h.ctx.db.query(`SELECT count(*) AS n FROM ngo_billing b JOIN donations d ON TRUE WHERE d.donor_id = $1 AND b.ngo_id::text = d.donor_id::text`, [f.donor.orgId]);
    expect(donorBilling.rows[0]?.n).toBe(0); // donors are never billed

    // Food in transit, then delivery confirmation completes the allocation.
    const t = await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_DESTINATION', consent: true }).expect(201);
    expect(t.body.data.stage).toBe('TO_DESTINATION');
    await h.http.post(`/api/pickups/${f.pickupId}/confirm-delivery`).set(f.ngo.auth).send({ deliveredQuantity: 40, beneficiariesServed: 40 }).expect(200);
    const alloc = await h.ctx.db.query('SELECT status, handed_over_quantity FROM donation_allocations WHERE id = $1', [f.allocationId]);
    expect(alloc.rows[0]).toMatchObject({ status: 'COMPLETED', handed_over_quantity: 40 });
    const donorNotes = await h.http.get('/api/notifications').set(f.donor.auth).expect(200);
    expect(donorNotes.body.data.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['REWARD_CREDITED', 'DELIVERY_CONFIRMED']));
  });

  it('awards 10 points per order for packets and splits meals across the 500-meal threshold', async () => {
    const f = await pickupFixture(h, { unit: 'PACKETS', quantity: 30, approve: 25 });
    await verifyPickup(h, f);
    await confirmBoth(h, f, 25, 25);
    expect((await balance(f.donor.orgId))?.balance).toBe(10);
    const fee = await h.ctx.db.query('SELECT total_amount FROM ngo_billing');
    expect(fee.rows[0]?.total_amount).toBe(125); // ₹5 × 25 packets

    await resetDatabase(h.ctx.db);
    const g = await pickupFixture(h, { approve: 40 });
    await h.ctx.db.query('INSERT INTO reward_balances (donor_id, balance, lifetime_points, lifetime_meals) VALUES ($1, 4800, 4800, 480)', [g.donor.orgId]);
    await verifyPickup(h, g);
    await confirmBoth(h, g, 40, 40);
    expect(await balance(g.donor.orgId)).toMatchObject({ balance: 4800 + 20 * 10 + 20 * 15, lifetime_meals: 520 });
    const ledger = await h.ctx.db.query<{ points: number; calculation: { lines: { units: number; pointsPerUnit: number }[] } }>('SELECT points, calculation FROM reward_transactions');
    expect(ledger.rows[0]?.points).toBe(500);
    expect(ledger.rows[0]?.calculation.lines.map((l) => [l.units, l.pointsPerUnit])).toEqual([[20, 10], [20, 15]]);
  });
});

describe('Scenario C: QR pass and identity-check security', () => {
  it('rejects unknown, reused, expired and revoked passes and blocks handover; every attempt is logged and audited', async () => {
    const f = await pickupFixture(h);
    const garbage = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: 'FBP1.not-a-real-token-value' }).expect(422);
    expect(garbage.body.error).toMatchObject({ code: 'QR_REJECTED', details: { reason: 'TOKEN_NOT_FOUND' } });

    const pass1 = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(200);
    const pass2 = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(200);
    const revoked = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass1.body.data.token }).expect(422);
    expect(revoked.body.error.details.reason).toBe('TOKEN_REVOKED'); // regenerating revokes the previous pass

    await h.ctx.db.query(`UPDATE pickup_tokens SET expires_at = now() - interval '1 minute' WHERE consumed_at IS NULL AND revoked_at IS NULL`);
    const expired = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass2.body.data.token }).expect(422);
    expect(expired.body.error.details.reason).toBe('TOKEN_EXPIRED');

    const pass3 = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(200);
    await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass3.body.data.token }).expect(200);
    const reused = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass3.body.data.token }).expect(422);
    expect(reused.body.error.details.reason).toBe('TOKEN_CONSUMED');

    await h.http.post('/api/pickups/confirm-handover').set(f.ngo.auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(409);
    const reasons = (await verificationReasons()).map((r) => r.failure_reason).filter(Boolean);
    expect(reasons).toEqual(['TOKEN_NOT_FOUND', 'TOKEN_REVOKED', 'TOKEN_EXPIRED', 'TOKEN_CONSUMED']);
    const audits = await h.ctx.db.query(`SELECT count(*) AS n FROM audit_logs WHERE action = 'pickup.qr_rejected'`);
    expect(audits.rows[0]?.n).toBe(4);
  });

  it('rejects a pass presented to the wrong donor and a representative whose authorisation was revoked', async () => {
    const f = await pickupFixture(h);
    const other = await registerDonor(h, { name: 'Unrelated Cafe' });
    await approve(h, f.admin, 'donor', other.orgId);
    const pass = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(200);
    const wrong = await h.http.post('/api/pickups/verify-qr').set(other.auth).send({ token: pass.body.data.token }).expect(422);
    expect(wrong.body.error.details.reason).toBe('WRONG_DONOR');
    // The pass is not consumed by a wrong-donor scan, but revoking the representative kills it.
    await h.http.patch(`/api/ngos/me/representatives/${f.representativeId}`).set(f.ngo.auth).send({ status: 'INACTIVE' }).expect(204);
    const inactive = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass.body.data.token }).expect(422);
    expect(['TOKEN_REVOKED', 'REPRESENTATIVE_INACTIVE']).toContain(inactive.body.error.details.reason);
    await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(403);
  });

  it('refuses the identity step before the QR pass is verified and for another donor', async () => {
    const f = await pickupFixture(h);
    const early = await h.http.post('/api/pickups/confirm-identity').set(f.donor.auth).send({ pickupId: f.pickupId }).expect(409);
    expect(early.body.error.code).toBe('VERIFICATION_INCOMPLETE');
    const pass = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId }).expect(200);
    await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass.body.data.token }).expect(200);
    const other = await registerDonor(h, { name: 'Unrelated Cafe' });
    await approve(h, f.admin, 'donor', other.orgId);
    await h.http.post('/api/pickups/confirm-identity').set(other.auth).send({ pickupId: f.pickupId }).expect(404);
    await h.http.post('/api/pickups/confirm-identity').set(f.donor.auth).send({ pickupId: f.pickupId }).expect(200);
    const again = await h.http.post('/api/pickups/confirm-identity').set(f.donor.auth).send({ pickupId: f.pickupId }).expect(409);
    expect(again.body.error.code).toBe('PICKUP_NOT_ACTIVE');
  });

  it('no longer exposes the removed OTP endpoints', async () => {
    const f = await pickupFixture(h);
    await h.http.post('/api/pickups/verify-otp').set(f.donor.auth).send({ pickupId: f.pickupId, code: '123456' }).expect(404);
    await h.http.post('/api/pickups/resend-otp').set(f.donor.auth).send({ pickupId: f.pickupId }).expect(404);
    const detail = await h.http.get(`/api/pickups/${f.pickupId}`).set(f.donor.auth).expect(200);
    expect(detail.body.data).not.toHaveProperty('otp');
    expect(Object.keys(detail.body.data.checks).sort()).toEqual(['identityConfirmedAt', 'qrVerifiedAt']);
  });

  it('refuses the handover once the representative is deactivated after verification', async () => {
    const f = await pickupFixture(h);
    await verifyPickup(h, f);
    await h.http.patch(`/api/ngos/me/representatives/${f.representativeId}`).set(f.ngo.auth).send({ status: 'INACTIVE' }).expect(204);
    for (const auth of [f.donor.auth, f.ngo.auth]) {
      const res = await h.http.post('/api/pickups/confirm-handover').set(auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(403);
      expect(res.body.error.code).toBe('REPRESENTATIVE_INACTIVE');
    }
    const handover = await h.ctx.db.query('SELECT count(*) AS n FROM handover_records WHERE pickup_assignment_id = $1', [f.pickupId]);
    expect(handover.rows[0]?.n).toBe(0);
  });
});

describe('handover integrity: duplicates, mismatches and disputes', () => {
  it('prevents duplicate confirmations, duplicate rewards and duplicate billing', async () => {
    const f = await pickupFixture(h);
    await verifyPickup(h, f);
    await confirmBoth(h, f, 40, 40);
    const again = await h.http.post('/api/pickups/confirm-handover').set(f.donor.auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(409);
    expect(again.body.error.code).toBe('HANDOVER_NOT_ALLOWED');
    const handover = await h.ctx.db.query<{ id: string }>('SELECT id FROM handover_records');
    const hid = handover.rows[0]?.id as string;
    // Re-running the credit and fee logic directly (e.g. a retried job) changes nothing.
    const credit = await h.ctx.db.transaction((tx) => h.services.rewards.creditForHandover(tx, hid, 40, SYSTEM_ACTOR));
    const fee = await h.ctx.db.transaction((tx) => h.services.billing.recordFeeForHandover(tx, hid, 40, SYSTEM_ACTOR));
    expect(credit.duplicate).toBe(true);
    expect(fee.duplicate).toBe(true);
    expect((await balance(f.donor.orgId))?.balance).toBe(400);
    const counts = await h.ctx.db.query('SELECT (SELECT count(*) FROM reward_transactions) AS rewards, (SELECT count(*) FROM ngo_billing) AS fees');
    expect(counts.rows[0]).toEqual({ rewards: 1, fees: 1 });
    // The ledger is append-only.
    await expect(h.ctx.db.query('UPDATE reward_transactions SET points = 999999')).rejects.toThrow(/append-only/);
    await expect(h.ctx.db.query('DELETE FROM reward_transactions')).rejects.toThrow(/append-only/);
  });

  it('flags a quantity mismatch as a dispute with no points or fees until an admin resolves it', async () => {
    const f = await pickupFixture(h);
    await verifyPickup(h, f);
    const res = await confirmBoth(h, f, 40, 35);
    expect(res.body.data.outcome).toBe('DISPUTED');
    expect(await balance(f.donor.orgId)).toBeUndefined();
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM ngo_billing')).rows[0]?.n).toBe(0);
    const alloc = await h.ctx.db.query('SELECT status FROM donation_allocations WHERE id = $1', [f.allocationId]);
    expect(alloc.rows[0]?.status).toBe('DISPUTED');
    const adminNotes = await h.http.get('/api/notifications').set(f.admin.auth).expect(200);
    expect(adminNotes.body.data.some((n: { type: string }) => n.type === 'DISPUTE_OPENED')).toBe(true);

    const disputes = await h.http.get('/api/disputes').set(f.admin.auth).expect(200);
    expect(disputes.body.data[0]).toMatchObject({ type: 'QUANTITY_MISMATCH', status: 'OPEN', donorQuantity: 40, ngoQuantity: 35 });
    await h.http.patch(`/api/admin/disputes/${disputes.body.data[0].id}/resolve`).set(f.donor.auth).send({ outcome: 'CONFIRM_QUANTITY', resolvedQuantity: 36, resolution: 'x' }).expect(403);
    await h.http
      .patch(`/api/admin/disputes/${disputes.body.data[0].id}/resolve`)
      .set(f.admin.auth)
      .send({ outcome: 'CONFIRM_QUANTITY', resolvedQuantity: 36, resolution: 'Photos show 36 meals were handed over.' })
      .expect(204);
    expect((await balance(f.donor.orgId))?.balance).toBe(360);
    const fee = await h.ctx.db.query('SELECT total_amount FROM ngo_billing');
    expect(fee.rows[0]?.total_amount).toBe(180);
    await h.http.patch(`/api/admin/disputes/${disputes.body.data[0].id}/resolve`).set(f.admin.auth).send({ outcome: 'CANCEL_COLLECTION', resolution: 'again' }).expect(409);
    expect(disputes.body.data[0].unit).toBe('MEALS');
    // Each party's "resolved" notification opens their own view of the collection.
    for (const [who, path] of [[f.donor, `/donor/pickups/${f.pickupId}`], [f.ngo, `/ngo/pickups/${f.pickupId}`]] as const) {
      const notes = await h.http.get('/api/notifications').set(who.auth).expect(200);
      const resolved = notes.body.data.find((n: { type: string }) => n.type === 'DISPUTE_RESOLVED');
      expect(resolved?.linkPath).toBe(path);
    }
  });

  it('a cancelled collection is never billed and earns no points', async () => {
    const f = await pickupFixture(h);
    await h.http.post(`/api/allocations/${f.allocationId}/cancel`).set(f.ngo.auth).send({ reason: 'no volunteers today' }).expect(204);
    const pickup = await h.ctx.db.query('SELECT status FROM pickup_assignments WHERE id = $1', [f.pickupId]);
    expect(pickup.rows[0]?.status).toBe('CANCELLED');
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM ngo_billing')).rows[0]?.n).toBe(0);
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM reward_transactions')).rows[0]?.n).toBe(0);
  });

  it('a no-show returns the reservation so a new representative can be assigned', async () => {
    const f = await pickupFixture(h);
    await h.http.post(`/api/pickups/${f.pickupId}/report-failure`).set(f.donor.auth).send({ reason: 'representative did not arrive' }).expect(200);
    const alloc = await h.ctx.db.query('SELECT status FROM donation_allocations WHERE id = $1', [f.allocationId]);
    expect(alloc.rows[0]?.status).toBe('RESERVED');
    await h.http.post('/api/pickups/assign').set(f.ngo.auth).send({ allocationId: f.allocationId, representativeId: f.representativeId }).expect(201);
  });
});

describe('representatives', () => {
  it('invites a representative who sets a password through a single-use link', async () => {
    const f = await pickupFixture(h);
    const res = await h.http
      .post('/api/ngos/me/representatives')
      .set(f.ngo.auth)
      .send({ fullName: 'Kiran Patil', email: 'kiran.rep@example.org', phone: '+919822223333', idDocumentType: 'DRIVING_LICENCE', idDocumentLast4: 'AB12' })
      .expect(201);
    const token = new URL(res.body.data.inviteUrl).searchParams.get('token') as string;
    await h.http.post('/api/auth/login').send({ email: 'kiran.rep@example.org', password: 'whatever-123' }).expect(401);
    const accepted = await h.http.post('/api/auth/accept-invite').send({ token, password: 'Kiran-pass-123' }).expect(200);
    expect(accepted.body.data.user.representative).toMatchObject({ ngoName: 'Helping Hands', status: 'ACTIVE' });
    await h.http.post('/api/auth/accept-invite').send({ token, password: 'Kiran-pass-456' }).expect(422);
    // Representatives cannot manage the NGO.
    await h.http.post('/api/assistance-requests').set({ Authorization: `Bearer ${accepted.body.data.accessToken}` }).send({}).expect(403);
    // Only the assigned representative can generate a pass.
    const repAuth = { Authorization: `Bearer ${accepted.body.data.accessToken}` };
    await h.http.post('/api/pickups/generate-pass').set(repAuth).send({ pickupId: f.pickupId }).expect(404);
    const d = await createDonation(h, f.donor, f.cooked, { foodName: 'Second batch' });
    const rid = await requestDonation(h, f.ngo, d.id, 10);
    const appr = await h.http.patch(`/api/requests/${rid}/approve`).set(f.donor.auth).send({}).expect(200);
    const assigned = await h.http.post('/api/pickups/assign').set(f.ngo.auth).send({ allocationId: appr.body.data.allocationId, representativeId: res.body.data.id }).expect(201);
    await h.http.post('/api/pickups/generate-pass').set(repAuth).send({ pickupId: assigned.body.data.id }).expect(200);
  });
});

describe('handover integrity under contention (review regressions)', () => {
  it('resolves a dispute exactly once and fully unwinds a cancelled collection', async () => {
    const f = await pickupFixture(h);
    await verifyPickup(h, f);
    await confirmBoth(h, f, 40, 35);
    const dispute = (await h.http.get('/api/disputes').set(f.admin.auth).expect(200)).body.data[0];
    const cancel = () =>
      h.http.patch(`/api/admin/disputes/${dispute.id}/resolve`).set(f.admin.auth).send({ outcome: 'CANCEL_COLLECTION', resolution: 'Cancelled after review.' });
    const results = await Promise.all([cancel(), cancel()]); // e.g. a double click
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('DISPUTE_CLOSED');
    const state = await h.ctx.db.query(
      `SELECT d.reserved_quantity AS reserved, a.status AS allocation, p.status AS pickup, r.status AS request
         FROM donation_allocations a JOIN donations d ON d.id = a.donation_id JOIN pickup_assignments p ON p.allocation_id = a.id
         JOIN donation_requests r ON r.id = a.donation_request_id WHERE a.id = $1`,
      [f.allocationId],
    );
    // Quantity released once (not twice), and the source request unwound too.
    expect(state.rows[0]).toEqual({ reserved: 0, allocation: 'CANCELLED', pickup: 'CANCELLED', request: 'CANCELLED' });
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM ngo_billing')).rows[0]?.n).toBe(0);
  });

  it('does not let either side void a handover the other side has already confirmed', async () => {
    const f = await pickupFixture(h);
    await verifyPickup(h, f);
    await h.http.post('/api/pickups/confirm-handover').set(f.donor.auth).send({ pickupId: f.pickupId, quantity: 40 }).expect(200);
    const cancel = await h.http.post(`/api/allocations/${f.allocationId}/cancel`).set(f.ngo.auth).send({ reason: 'changed our mind' }).expect(409);
    expect(cancel.body.error.code).toBe('HANDOVER_IN_PROGRESS');
    await h.http.post(`/api/donations/${f.donationId}/cancel`).set(f.donor.auth).send({ reason: 'cancel everything' }).expect(409);
    // Reporting failure after the donor confirmed opens a dispute instead of voiding the handover.
    await h.http.post(`/api/pickups/${f.pickupId}/report-failure`).set(f.ngo.auth).send({ reason: 'nothing was handed over' }).expect(200);
    const state = await h.ctx.db.query(
      `SELECT p.status AS pickup, a.status AS allocation, d.reserved_quantity AS reserved FROM pickup_assignments p
         JOIN donation_allocations a ON a.id = p.allocation_id JOIN donations d ON d.id = a.donation_id WHERE p.id = $1`,
      [f.pickupId],
    );
    expect(state.rows[0]).toEqual({ pickup: 'DISPUTED', allocation: 'DISPUTED', reserved: 40 });
    const disputes = (await h.http.get('/api/disputes').set(f.admin.auth).expect(200)).body.data;
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ type: 'QUANTITY_MISMATCH', status: 'OPEN', donorQuantity: 40 });
    expect(await balance(f.donor.orgId)).toBeUndefined();
    await h.http
      .patch(`/api/admin/disputes/${disputes[0].id}/resolve`)
      .set(f.admin.auth)
      .send({ outcome: 'CONFIRM_QUANTITY', resolvedQuantity: 40, resolution: 'CCTV shows 40 meals were handed over.' })
      .expect(204);
    expect((await balance(f.donor.orgId))?.balance).toBe(400);
  });

  it('stops a revoked representative at the identity step and removes their NGO-wide access', async () => {
    const f = await pickupFixture(h);
    const invited = await h.http
      .post('/api/ngos/me/representatives')
      .set(f.ngo.auth)
      .send({ fullName: 'Asha Rep', email: 'asha.rep@example.org', phone: '+919833334444', idDocumentType: 'AADHAAR', idDocumentLast4: '5678' })
      .expect(201);
    const token = new URL(invited.body.data.inviteUrl).searchParams.get('token') as string;
    const accepted = await h.http.post('/api/auth/accept-invite').send({ token, password: 'Asha-pass-1234' }).expect(200);
    const repAuth = { Authorization: `Bearer ${accepted.body.data.accessToken}` };
    const d = await createDonation(h, f.donor, f.cooked, { foodName: 'Rep batch' });
    const rid = await requestDonation(h, f.ngo, d.id, 20);
    const approved = await h.http.patch(`/api/requests/${rid}/approve`).set(f.donor.auth).send({}).expect(200);
    const assigned = await h.http.post('/api/pickups/assign').set(f.ngo.auth).send({ allocationId: approved.body.data.allocationId, representativeId: invited.body.data.id }).expect(201);
    const pass = await h.http.post('/api/pickups/generate-pass').set(repAuth).send({ pickupId: assigned.body.data.id }).expect(200);
    await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass.body.data.token }).expect(200);
    await h.http.patch(`/api/ngos/me/representatives/${invited.body.data.id}`).set(f.ngo.auth).send({ status: 'REVOKED' }).expect(204);
    const identity = await h.http.post('/api/pickups/confirm-identity').set(f.donor.auth).send({ pickupId: assigned.body.data.id }).expect(403);
    expect(identity.body.error.code).toBe('REPRESENTATIVE_INACTIVE');
    const status = await h.ctx.db.query('SELECT status, identity_confirmed_at FROM pickup_assignments WHERE id = $1', [assigned.body.data.id]);
    expect(status.rows[0]).toEqual({ status: 'ASSIGNED', identity_confirmed_at: null });
    // Signing in again gives no NGO-wide view and no say in the handover.
    const relog = await h.http.post('/api/auth/login').send({ email: 'asha.rep@example.org', password: 'Asha-pass-1234' }).expect(200);
    const again = { Authorization: `Bearer ${relog.body.data.accessToken}` };
    expect((await h.http.get('/api/allocations').set(again).expect(200)).body.data).toEqual([]);
    expect((await h.http.get('/api/disputes').set(again).expect(200)).body.data).toEqual([]);
    await h.http.post('/api/pickups/confirm-handover').set(again).send({ pickupId: assigned.body.data.id, quantity: 20 }).expect(404);
  });
});
