import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiStub } from './helpers/ai-stub.js';
import { PLACES, approve, approvedPair, categoryId, createAdmin, registerDonor, registerNgo, type Account } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { createDonation, donationRow, inMinutes, requestDonation } from './helpers/workflow.js';

let h: Harness;
const stub = new AiStub();

beforeAll(async () => {
  await stub.start(process.env.INTERNAL_SERVICE_TOKEN as string);
  // The real AiClient talks to the stub (a contract-level fake of the Python service).
  h = await createHarness((c) => ({ ...c, ai: { ...c.ai, url: stub.url, timeoutMs: 1500 } }));
});
beforeEach(async () => {
  stub.mode = 'ok';
  stub.calls.length = 0;
  await resetDatabase(h.ctx.db);
});
afterAll(async () => {
  await stub.stop();
  await h.close();
});

describe('donation creation and validation', () => {
  it('blocks unverified donors from creating donations', async () => {
    const donor = await registerDonor(h);
    const res = await h.http.post('/api/donations').set(donor.auth).send({}).expect(403);
    expect(res.body.error.code).toBe('ORGANISATION_NOT_APPROVED');
  });

  it('creates an AVAILABLE donation with history, audit and a queued matching job', async () => {
    const { donor, cooked } = await approvedPair(h);
    const d = await createDonation(h, donor, cooked);
    const row = await donationRow(h, d.id);
    expect(row).toMatchObject({ status: 'AVAILABLE', quantity: 100, reserved_quantity: 0 });
    const jobs = await h.ctx.db.query(`SELECT type FROM jobs WHERE type = 'match-donation'`);
    expect(jobs.rowCount).toBe(1);
  });

  it('requires safety confirmation to publish, and refuses future preparation times and past deadlines', async () => {
    const { donor, cooked } = await approvedPair(h);
    const base = { foodName: 'Paneer curry', categoryId: cooked, dietaryType: 'VEG', quantity: 10, unit: 'MEALS', storageType: 'HOT_HELD', address: 'Wakad Road, Pune' };
    const noSafety = await h.http.post('/api/donations').set(donor.auth).send({ ...base, preparedAt: inMinutes(-10), pickupDeadline: inMinutes(120), safetyConfirmed: false }).expect(422);
    expect(noSafety.body.error.code).toBe('SAFETY_CONFIRMATION_REQUIRED');
    const future = await h.http.post('/api/donations').set(donor.auth).send({ ...base, preparedAt: inMinutes(60), pickupDeadline: inMinutes(180), safetyConfirmed: true }).expect(422);
    expect(future.body.error.code).toBe('PREPARED_IN_FUTURE');
    const past = await h.http.post('/api/donations').set(donor.auth).send({ ...base, preparedAt: inMinutes(-60), pickupDeadline: inMinutes(5), safetyConfirmed: true }).expect(422);
    expect(past.body.error.code).toBe('DEADLINE_TOO_SOON');
    const fractional = await h.http.post('/api/donations').set(donor.auth).send({ ...base, quantity: 2.5, preparedAt: inMinutes(-10), pickupDeadline: inMinutes(120), safetyConfirmed: true }).expect(422);
    expect(fractional.body.error.code).toBe('VALIDATION_ERROR');
    const kg = await h.http.post('/api/donations').set(donor.auth).send({ ...base, unit: 'KG', preparedAt: inMinutes(-10), pickupDeadline: inMinutes(120), safetyConfirmed: true }).expect(422);
    expect(kg.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('flags (but does not block) long gaps between preparation and pickup — food safety stays a human decision', async () => {
    const { donor, cooked } = await approvedPair(h);
    const d = await createDonation(h, donor, cooked, { preparedAt: inMinutes(-60), pickupDeadline: inMinutes(9 * 60) });
    expect(d.warnings[0]).toMatch(/extra care/);
  });

  it('saves drafts without matching and publishes them later with optimistic locking', async () => {
    const { donor, cooked } = await approvedPair(h);
    const draft = await createDonation(h, donor, cooked, { publish: false, safetyConfirmed: false });
    expect((await donationRow(h, draft.id))?.status).toBe('DRAFT');
    await h.http.patch(`/api/donations/${draft.id}`).set(donor.auth).send({ version: draft.version + 5, publish: true, safetyConfirmed: true }).expect(409);
    const published = await h.http.patch(`/api/donations/${draft.id}`).set(donor.auth).send({ version: draft.version, publish: true, safetyConfirmed: true }).expect(200);
    expect(published.body.data.status).toBe('AVAILABLE');
  });
});

describe('Workflow A: matching, request, approval', () => {
  it('ranks eligible NGOs via the AI service, explains ineligible ones, and notifies the eligible NGO', async () => {
    const admin = await createAdmin(h);
    const { donor, ngo, cooked } = await approvedPair(h, admin);
    const far = await registerNgo(h, { name: 'Far Away Trust', location: PLACES.lonavala });
    await approve(h, admin, 'ngo', far.orgId);
    const nonVeg = await registerNgo(h, { name: 'Meat Only Shelter', location: PLACES.baner });
    await approve(h, admin, 'ngo', nonVeg.orgId);
    await h.http.patch('/api/ngos/me').set(nonVeg.auth).send({ acceptsVeg: false, acceptsNonVeg: true }).expect(200);
    await h.http.put('/api/ngos/me/food-preferences').set(nonVeg.auth).send({ categoryIds: [cooked] }).expect(200);

    const d = await createDonation(h, donor, cooked);
    const processed = await h.worker.runDue();
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(stub.calls.some((c) => c.path === '/ai/match-ngos' && c.authorized)).toBe(true);

    const recs = await h.http.get(`/api/matching/ngos?donationId=${d.id}`).set(donor.auth).expect(200);
    expect(recs.body.data.rankingStatus).toBe('RANKED');
    const eligible = recs.body.data.items.filter((i: { eligible: boolean }) => i.eligible);
    expect(eligible.map((i: { candidate: { id: string } }) => i.candidate.id)).toEqual([ngo.orgId]);
    expect(eligible[0].score).toBeGreaterThan(0);
    expect(eligible[0].explanation).toBeTruthy();
    const veg = recs.body.data.items.find((i: { candidate: { id: string } }) => i.candidate.id === nonVeg.orgId);
    expect(veg.ineligibilityReasons.map((r: { code: string }) => r.code)).toContain('DIETARY_INCOMPATIBLE');
    // Lonavala is beyond the 25 km candidate search radius entirely.
    expect(recs.body.data.items.some((i: { candidate: { id: string } }) => i.candidate.id === far.orgId)).toBe(false);

    const notes = await h.http.get('/api/notifications').set(ngo.auth).expect(200);
    expect(notes.body.data.some((n: { type: string }) => n.type === 'DONATION_MATCH')).toBe(true);
    const nonVegNotes = await h.http.get('/api/notifications').set(nonVeg.auth).expect(200);
    expect(nonVegNotes.body.data.some((n: { type: string }) => n.type === 'DONATION_MATCH')).toBe(false);

    const recommended = await h.http.get('/api/matching/donations').set(ngo.auth).expect(200);
    expect(recommended.body.data[0].donation.id).toBe(d.id);
  });

  it('falls back to distance ordering, clearly labelled, when the AI service is down — core flow continues', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    stub.mode = 'down';
    const d = await createDonation(h, donor, cooked);
    await h.worker.runDue();
    const recs = await h.http.get(`/api/matching/ngos?donationId=${d.id}`).set(donor.auth).expect(200);
    expect(recs.body.data.rankingStatus).toBe('RANKING_UNAVAILABLE');
    const top = recs.body.data.items[0];
    expect(top.score).toBeNull();
    expect(top.limitations.join(' ')).toMatch(/AI ranking was unavailable/);
    // The donation workflow still works end to end.
    const requestId = await requestDonation(h, ngo, d.id, 40);
    await h.http.patch(`/api/requests/${requestId}/approve`).set(donor.auth).send({}).expect(200);
    expect(await donationRow(h, d.id)).toMatchObject({ status: 'PARTIALLY_RESERVED', reserved_quantity: 40 });
  });

  it('runs the full request → approve flow with fee estimate, notifications and allocation', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const d = await createDonation(h, donor, cooked);
    const created = await h.http.post(`/api/donations/${d.id}/requests`).set(ngo.auth).send({ quantity: 40 }).expect(201);
    expect(created.body.data.feeEstimate).toMatchObject({ baseAmount: 200, totalAmount: 200, isEstimate: true });
    await h.http.post(`/api/donations/${d.id}/requests`).set(ngo.auth).send({ quantity: 10 }).expect(409);

    const incoming = await h.http.get('/api/requests').set(donor.auth).expect(200);
    expect(incoming.body.data[0]).toMatchObject({ status: 'PENDING', requestedQuantity: 40 });
    const approved = await h.http.patch(`/api/requests/${created.body.data.id}/approve`).set(donor.auth).send({ quantity: 30 }).expect(200);
    expect(approved.body.data.approvedQuantity).toBe(30);
    await h.http.patch(`/api/requests/${created.body.data.id}/approve`).set(donor.auth).send({}).expect(409);

    expect(await donationRow(h, d.id)).toMatchObject({ status: 'PARTIALLY_RESERVED', reserved_quantity: 30 });
    const allocations = await h.http.get('/api/allocations').set(ngo.auth).expect(200);
    expect(allocations.body.data[0]).toMatchObject({ quantity: 30, status: 'RESERVED', source: 'DONATION_REQUEST' });
    const notes = await h.http.get('/api/notifications').set(ngo.auth).expect(200);
    expect(notes.body.data.some((n: { type: string }) => n.type === 'REQUEST_APPROVED')).toBe(true);
  });

  it('prevents NGOs from requesting food they cannot accept and donors from approving others\' requests', async () => {
    const admin = await createAdmin(h);
    const { donor, ngo, cooked } = await approvedPair(h, admin);
    const bakery = await categoryId(h, 'BAKERY');
    const d = await createDonation(h, donor, bakery, { foodName: 'Bread loaves' });
    const res = await h.http.post(`/api/donations/${d.id}/requests`).set(ngo.auth).send({ quantity: 5 }).expect(422);
    expect(res.body.error.code).toBe('CATEGORY_NOT_ACCEPTED');
    const d2 = await createDonation(h, donor, cooked);
    const rid = await requestDonation(h, ngo, d2.id, 10);
    const otherDonor = await registerDonor(h, { name: 'Other Cafe' });
    await approve(h, admin, 'donor', otherDonor.orgId);
    await h.http.patch(`/api/requests/${rid}/approve`).set(otherDonor.auth).send({}).expect(404);
    await h.http.patch(`/api/requests/${rid}/approve`).set(ngo.auth).send({}).expect(403);
  });

  it('never over-allocates when NGOs race for the last units (atomic reservation)', async () => {
    const admin = await createAdmin(h);
    const { donor, cooked } = await approvedPair(h, admin);
    const d = await createDonation(h, donor, cooked, { quantity: 50 });
    const ngos: Account[] = [];
    for (let i = 0; i < 5; i++) {
      const n = await registerNgo(h, { name: `Racing NGO ${i}` });
      await approve(h, admin, 'ngo', n.orgId);
      await h.http.put('/api/ngos/me/food-preferences').set(n.auth).send({ categoryIds: [cooked] }).expect(200);
      ngos.push(n);
    }
    const requestIds = await Promise.all(ngos.map((n) => requestDonation(h, n, d.id, 20)));
    const results = await Promise.all(requestIds.map((id) => h.http.patch(`/api/requests/${id}/approve`).set(donor.auth).send({})));
    const okCount = results.filter((r) => r.status === 200).length;
    const conflicts = results.filter((r) => r.status === 409);
    expect(okCount).toBe(2); // 2 × 20 = 40 ≤ 50; a third 20 would exceed
    expect(conflicts.every((r) => ['INSUFFICIENT_QUANTITY', 'DONATION_NOT_AVAILABLE'].includes(r.body.error.code))).toBe(true);
    const row = await donationRow(h, d.id);
    expect(row?.reserved_quantity).toBe(40);
    const sum = await h.ctx.db.query<{ s: number }>(`SELECT COALESCE(sum(quantity),0) AS s FROM donation_allocations WHERE donation_id = $1 AND status NOT IN ('CANCELLED','EXPIRED')`, [d.id]);
    expect(sum.rows[0]?.s).toBe(row?.reserved_quantity);
    // The remaining 10 can still be approved for a smaller quantity.
    const leftover = requestIds[results.findIndex((r) => r.status === 409)] as string;
    await h.http.patch(`/api/requests/${leftover}/approve`).set(donor.auth).send({ quantity: 10 }).expect(200);
    expect(await donationRow(h, d.id)).toMatchObject({ status: 'RESERVED', reserved_quantity: 50 });
  });

  it('the database CHECK constraint is a backstop against over-reservation even if code were bypassed', async () => {
    const { donor, cooked } = await approvedPair(h);
    const d = await createDonation(h, donor, cooked, { quantity: 10 });
    await expect(h.ctx.db.query('UPDATE donations SET reserved_quantity = 11 WHERE id = $1', [d.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('proposes an optimised split across pending requests and applies it atomically', async () => {
    const admin = await createAdmin(h);
    const { donor, ngo, cooked } = await approvedPair(h, admin);
    const ngo2 = await registerNgo(h, { name: 'Second NGO', location: PLACES.baner });
    await approve(h, admin, 'ngo', ngo2.orgId);
    await h.http.put('/api/ngos/me/food-preferences').set(ngo2.auth).send({ categoryIds: [cooked] }).expect(200);
    const d = await createDonation(h, donor, cooked, { quantity: 100 });
    await h.worker.runDue();
    const r1 = await requestDonation(h, ngo, d.id, 70);
    const r2 = await requestDonation(h, ngo2, d.id, 60);
    const proposal = await h.http.post('/api/matching/allocate').set(donor.auth).send({ donationId: d.id }).expect(200);
    expect(proposal.body.data.source).toBe('AI_OPTIMIZER');
    const total = proposal.body.data.allocations.reduce((s: number, a: { quantity: number }) => s + a.quantity, 0);
    expect(total).toBe(100);
    await h.http
      .post(`/api/donations/${d.id}/approve-batch`)
      .set(donor.auth)
      .send({ allocations: proposal.body.data.allocations.map((a: { requestId: string; quantity: number }) => ({ requestId: a.requestId, quantity: a.quantity })) })
      .expect(200);
    expect(await donationRow(h, d.id)).toMatchObject({ status: 'RESERVED', reserved_quantity: 100 });
    // A batch that would exceed availability changes nothing.
    const d2 = await createDonation(h, donor, cooked, { quantity: 30 });
    const a = await requestDonation(h, ngo, d2.id, 20);
    const b = await requestDonation(h, ngo2, d2.id, 20);
    await h.http.post(`/api/donations/${d2.id}/approve-batch`).set(donor.auth).send({ allocations: [{ requestId: a, quantity: 20 }, { requestId: b, quantity: 20 }] }).expect(409);
    expect(await donationRow(h, d2.id)).toMatchObject({ status: 'AVAILABLE', reserved_quantity: 0 });
    expect([r1, r2]).toHaveLength(2);
  });
});

describe('cancellation, idempotency and expiry', () => {
  it('cancelling an allocation releases its quantity and notifies the other party', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const d = await createDonation(h, donor, cooked);
    const rid = await requestDonation(h, ngo, d.id, 60);
    const { body } = await h.http.patch(`/api/requests/${rid}/approve`).set(donor.auth).send({}).expect(200);
    await h.http.post(`/api/allocations/${body.data.allocationId}/cancel`).set(ngo.auth).send({ reason: 'vehicle broke down' }).expect(204);
    expect(await donationRow(h, d.id)).toMatchObject({ status: 'AVAILABLE', reserved_quantity: 0 });
    const party = await h.ctx.db.query(`SELECT cancelled_by_party FROM donation_allocations WHERE id = $1`, [body.data.allocationId]);
    expect(party.rows[0]?.cancelled_by_party).toBe('NGO');
    const donorNotes = await h.http.get('/api/notifications').set(donor.auth).expect(200);
    expect(donorNotes.body.data.some((n: { type: string }) => n.type === 'ALLOCATION_CANCELLED')).toBe(true);
  });

  it('cancelling a donation releases reservations and cancels pending requests', async () => {
    const admin = await createAdmin(h);
    const { donor, ngo, cooked } = await approvedPair(h, admin);
    const ngo2 = await registerNgo(h, { name: 'Pending NGO' });
    await approve(h, admin, 'ngo', ngo2.orgId);
    await h.http.put('/api/ngos/me/food-preferences').set(ngo2.auth).send({ categoryIds: [cooked] }).expect(200);
    const d = await createDonation(h, donor, cooked);
    const rid = await requestDonation(h, ngo, d.id, 30);
    await h.http.patch(`/api/requests/${rid}/approve`).set(donor.auth).send({}).expect(200);
    const pending = await requestDonation(h, ngo2, d.id, 10);
    await h.http.post(`/api/donations/${d.id}/cancel`).set(donor.auth).send({ reason: 'kitchen inspection' }).expect(200);
    expect((await donationRow(h, d.id))?.status).toBe('CANCELLED');
    const statuses = await h.ctx.db.query<{ id: string; status: string }>('SELECT id, status FROM donation_requests WHERE donation_id = $1', [d.id]);
    expect(Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]))).toEqual({ [rid]: 'CANCELLED', [pending]: 'CANCELLED' });
  });

  it('tells NGOs when an administrator, not the donor, cancelled a donation', async () => {
    const admin = await createAdmin(h);
    const { donor, ngo, cooked } = await approvedPair(h, admin);
    const d = await createDonation(h, donor, cooked);
    await requestDonation(h, ngo, d.id, 10);
    await h.http.post(`/api/donations/${d.id}/cancel`).set(admin.auth).send({ reason: 'food safety complaint' }).expect(200);
    const notes = await h.http.get('/api/notifications').set(ngo.auth).expect(200);
    const n = notes.body.data.find((x: { type: string }) => x.type === 'DONATION_CANCELLED');
    expect(n?.body).toMatch(/^A FoodBridge administrator cancelled/);
  });

  it('replays duplicate submissions with the same Idempotency-Key and rejects key reuse with a different body', async () => {
    const { donor, cooked } = await approvedPair(h);
    const body = {
      foodName: 'Khichdi',
      categoryId: cooked,
      dietaryType: 'VEG',
      quantity: 25,
      unit: 'MEALS',
      preparedAt: inMinutes(-20),
      storageType: 'HOT_HELD',
      pickupDeadline: inMinutes(200),
      address: 'Wakad Road, Pune',
      safetyConfirmed: true,
    };
    const first = await h.http.post('/api/donations').set(donor.auth).set('Idempotency-Key', 'donation-key-0001').send(body).expect(201);
    const second = await h.http.post('/api/donations').set(donor.auth).set('Idempotency-Key', 'donation-key-0001').send(body).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    const count = await h.ctx.db.query(`SELECT count(*) AS n FROM donations WHERE food_name = 'Khichdi'`);
    expect(count.rows[0]?.n).toBe(1);
    await h.http.post('/api/donations').set(donor.auth).set('Idempotency-Key', 'donation-key-0001').send({ ...body, quantity: 26 }).expect(422);
  });

  it('expires unreserved donations and releases unassigned reservations after the deadline', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const d1 = await createDonation(h, donor, cooked, { foodName: 'Never reserved' });
    const d2 = await createDonation(h, donor, cooked, { foodName: 'Partly reserved' });
    const rid = await requestDonation(h, ngo, d2.id, 30);
    await h.http.patch(`/api/requests/${rid}/approve`).set(donor.auth).send({}).expect(200);
    // Move both deadlines into the past (and past the reservation grace period).
    await h.ctx.db.query(`UPDATE donations SET pickup_available_from = now() - interval '5 hours', prepared_at = now() - interval '6 hours', pickup_deadline = now() - interval '1 hour' WHERE id = ANY($1::uuid[])`, [[d1.id, d2.id]]);
    const summary = await h.services.expiry.run();
    expect(summary.donationsExpired).toBe(1);
    expect(summary.allocationsExpired).toBe(1);
    expect((await donationRow(h, d1.id))?.status).toBe('EXPIRED');
    expect((await donationRow(h, d2.id))?.status).toBe('EXPIRED');
    // Idempotent: a second run changes nothing.
    const again = await h.services.expiry.run();
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });
});

describe('marketplace listings (regression: count query parameters)', () => {
  it('lists the NGO marketplace and open assistance requests with and without a distance filter', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    await createDonation(h, donor, cooked);
    const market = await h.http.get('/api/donations').set(ngo.auth).expect(200);
    expect(market.body.meta.total).toBe(1);
    expect(market.body.data[0].distanceKm).toBeGreaterThan(0);
    const near = await h.http.get('/api/donations?maxDistanceKm=1&sort=distance').set(ngo.auth).expect(200);
    expect(near.body.meta.total).toBe(0);
    const open = await h.http.get('/api/assistance-requests?scope=open').set(donor.auth).expect(200);
    expect(open.body.meta.total).toBe(0);
    await h.http.get('/api/assistance-requests?status=OPEN').set(donor.auth).expect(200);
  });
});
