import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiStub } from './helpers/ai-stub.js';
import { PLACES, approve, approvedPair, createAdmin, registerDonor, type Account } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { createAssistanceRequest, inMinutes, offer } from './helpers/workflow.js';

let h: Harness;
const stub = new AiStub();
beforeAll(async () => {
  await stub.start(process.env.INTERNAL_SERVICE_TOKEN as string);
  h = await createHarness((c) => ({ ...c, ai: { ...c.ai, url: stub.url, timeoutMs: 1500 } }));
});
beforeEach(async () => {
  stub.mode = 'ok';
  await resetDatabase(h.ctx.db);
});
afterAll(async () => {
  await stub.stop();
  await h.close();
});

const request = async (id: string) =>
  (await h.ctx.db.query<{ status: string; quantity_committed: number }>('SELECT status, quantity_committed FROM food_assistance_requests WHERE id = $1', [id])).rows[0];

async function extraDonor(admin: Account, cooked: string, name: string, location = PLACES.baner) {
  const d = await registerDonor(h, { name, location });
  await approve(h, admin, 'donor', d.orgId);
  await h.http.put('/api/donors/me/categories').set(d.auth).send({ categoryIds: [cooked] }).expect(200);
  return d;
}

describe('Workflow B: NGO assistance request with partial fulfilment', () => {
  it('matches donors (forecast-aware), notifies them with the spec wording, and fills 150 meals from three partial offers', async () => {
    const admin = await createAdmin(h);
    const { donor: a, ngo, cooked } = await approvedPair(h, admin);
    const b = await extraDonor(admin, cooked, 'Restaurant B');
    const c = await extraDonor(admin, cooked, 'Restaurant C', PLACES.kothrud);
    // Historical surplus for donor A (labelled synthetic) feeds the quantity criterion.
    await h.ctx.db.query(
      `INSERT INTO restaurant_daily_metrics (donor_id, metric_date, meal_period, prepared_qty, sold_qty, surplus_qty, data_source)
       SELECT $1, current_date - g, mp, 200, 170, 30, 'SYNTHETIC' FROM generate_series(1, 30) g, unnest(ARRAY['BREAKFAST','LUNCH','DINNER']) mp`,
      [a.orgId],
    );
    const rid = await createAssistanceRequest(h, ngo, cooked);
    await h.worker.runDue();
    const recs = await h.http.get(`/api/matching/donors?requestId=${rid}`).set(ngo.auth).expect(200);
    const eligibleIds = recs.body.data.items.filter((i: { eligible: boolean }) => i.eligible).map((i: { candidate: { id: string } }) => i.candidate.id);
    expect(new Set(eligibleIds)).toEqual(new Set([a.orgId, b.orgId]));
    // Kothrud is ~13 km from Hinjewadi: outside the NGO's 10 km collection radius, so not matched (it may still offer).
    const kothrud = recs.body.data.items.find((i: { candidate: { id: string } }) => i.candidate.id === c.orgId);
    expect(kothrud.ineligibilityReasons.map((r: { code: string }) => r.code)).toEqual(['OUTSIDE_COLLECTION_RADIUS']);
    const call = stub.calls.find((x) => x.path === '/ai/match-donors');
    const candA = (call?.body as { candidates: { donor_id: string; historical_avg_surplus: number | null }[] }).candidates.find((x) => x.donor_id === a.orgId);
    expect(candA?.historical_avg_surplus).toBeGreaterThan(0);
    const note = (await h.http.get('/api/notifications').set(b.auth)).body.data.find((n: { type: string }) => n.type === 'ASSISTANCE_MATCH');
    expect(note.body).toMatch(/needs 150 vegetarian meals/);
    expect(note.body).toMatch(/may be able to contribute based on its available quantity and historical surplus/);

    const oa = await offer(h, a, rid, 50);
    const ob = await offer(h, b, rid, 60);
    const oc = await offer(h, c, rid, 40);
    const accA = await h.http.patch(`/api/offers/${oa}/accept`).set(ngo.auth).send({}).expect(200);
    expect(accA.body.data.feeEstimate).toMatchObject({ baseAmount: 250, isEstimate: true });
    expect(await request(rid)).toMatchObject({ status: 'PARTIALLY_FULFILLED', quantity_committed: 50 });
    await h.http.patch(`/api/offers/${ob}/accept`).set(ngo.auth).send({}).expect(200);
    await h.http.patch(`/api/offers/${oc}/accept`).set(ngo.auth).send({}).expect(200);
    expect(await request(rid)).toMatchObject({ status: 'FULFILLED', quantity_committed: 150 });

    // Each offer has its own lifecycle: donors confirm actual food, creating independent allocations.
    for (const [donor, id, q] of [[a, oa, 50], [b, ob, 60], [c, oc, 40]] as const) {
      await h.http.patch(`/api/offers/${id}/confirm`).set(donor.auth).send({ confirmedQuantity: q, preparedAt: inMinutes(-5), storageType: 'HOT_HELD', safetyConfirmed: true }).expect(200);
    }
    const allocations = await h.http.get('/api/allocations').set(ngo.auth).expect(200);
    expect(allocations.body.data).toHaveLength(3);
    expect(allocations.body.data.every((x: { source: string; status: string }) => x.source === 'ASSISTANCE_OFFER' && x.status === 'RESERVED')).toBe(true);
    const history = await h.ctx.db.query(`SELECT event_type FROM assistance_request_history WHERE assistance_request_id = $1 ORDER BY id`, [rid]);
    expect(history.rows.map((r) => r.event_type)).toEqual(expect.arrayContaining(['CREATED', 'OFFER_PROPOSED', 'OFFER_ACCEPTED', 'OFFER_RESERVED']));
  });

  it('never commits more than required, even when the NGO accepts offers concurrently', async () => {
    const admin = await createAdmin(h);
    const { ngo, cooked } = await approvedPair(h, admin);
    const rid = await createAssistanceRequest(h, ngo, cooked, { quantityRequired: 100 });
    const donors = await Promise.all([1, 2, 3, 4].map((i) => extraDonor(admin, cooked, `Racer ${i}`)));
    const offers = await Promise.all(donors.map((d) => offer(h, d, rid, 40)));
    const results = await Promise.all(offers.map((o) => h.http.patch(`/api/offers/${o}/accept`).set(ngo.auth).send({})));
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const row = await request(rid);
    expect(row).toMatchObject({ status: 'FULFILLED', quantity_committed: 100 });
    const accepted = await h.ctx.db.query<{ s: number }>(`SELECT COALESCE(sum(accepted_quantity),0) AS s FROM assistance_offers WHERE assistance_request_id = $1 AND status = 'ACCEPTED'`, [rid]);
    expect(accepted.rows[0]?.s).toBe(100); // e.g. 40 + 40 + 20 (the third acceptance is capped)
  });

  it('reserves ready-now food immediately on acceptance', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const rid = await createAssistanceRequest(h, ngo, cooked);
    const o = await offer(h, donor, rid, 30, { readyFood: { preparedAt: inMinutes(-10), storageType: 'HOT_HELD', safetyConfirmed: true } });
    const accepted = await h.http.patch(`/api/offers/${o}/accept`).set(ngo.auth).send({}).expect(200);
    expect(accepted.body.data.status).toBe('RESERVED');
    expect(accepted.body.data.allocationId).toBeTruthy();
  });

  it('a smaller confirmed quantity re-opens the shortfall on the request', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const rid = await createAssistanceRequest(h, ngo, cooked, { quantityRequired: 60 });
    const o = await offer(h, donor, rid, 60);
    await h.http.patch(`/api/offers/${o}/accept`).set(ngo.auth).send({}).expect(200);
    expect((await request(rid))?.status).toBe('FULFILLED');
    await h.http.patch(`/api/offers/${o}/confirm`).set(donor.auth).send({ confirmedQuantity: 45, preparedAt: inMinutes(-5), storageType: 'HOT_HELD', safetyConfirmed: true }).expect(200);
    expect(await request(rid)).toMatchObject({ status: 'PARTIALLY_FULFILLED', quantity_committed: 45 });
  });

  it('enforces dietary compatibility and one live offer per donor, and lets donors decline', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const rid = await createAssistanceRequest(h, ngo, cooked);
    const nonVeg = await h.http
      .post(`/api/assistance-requests/${rid}/offers`)
      .set(donor.auth)
      .send({ quantity: 10, foodName: 'Chicken curry', dietaryType: 'NON_VEG', pickupAvailableFrom: inMinutes(60), pickupDeadline: inMinutes(120), address: 'Wakad Road, Pune' })
      .expect(422);
    expect(nonVeg.body.error.code).toBe('DIETARY_INCOMPATIBLE');
    await offer(h, donor, rid, 10);
    const dup = await h.http
      .post(`/api/assistance-requests/${rid}/offers`)
      .set(donor.auth)
      .send({ quantity: 5, foodName: 'More rice', dietaryType: 'VEG', pickupAvailableFrom: inMinutes(60), pickupDeadline: inMinutes(120), address: 'Wakad Road, Pune' })
      .expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_OFFER');
  });

  it('cancelling the request rejects pending offers and releases reserved food', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const rid = await createAssistanceRequest(h, ngo, cooked);
    const o = await offer(h, donor, rid, 30, { readyFood: { preparedAt: inMinutes(-10), storageType: 'HOT_HELD', safetyConfirmed: true } });
    await h.http.patch(`/api/offers/${o}/accept`).set(ngo.auth).send({}).expect(200);
    await h.http.post(`/api/assistance-requests/${rid}/cancel`).set(ngo.auth).send({ reason: 'event postponed' }).expect(200);
    const offerRow = await h.ctx.db.query(`SELECT status, donation_id FROM assistance_offers WHERE id = $1`, [o]);
    expect(offerRow.rows[0]?.status).toBe('CANCELLED');
    const donation = await h.ctx.db.query(`SELECT status, reserved_quantity FROM donations WHERE id = $1`, [offerRow.rows[0]?.donation_id]);
    expect(donation.rows[0]).toMatchObject({ status: 'CANCELLED', reserved_quantity: 0 });
  });

  it('donor withdrawing an accepted offer returns the committed quantity', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const rid = await createAssistanceRequest(h, ngo, cooked, { quantityRequired: 80 });
    const o = await offer(h, donor, rid, 50);
    await h.http.patch(`/api/offers/${o}/accept`).set(ngo.auth).send({}).expect(200);
    await h.http.post(`/api/offers/${o}/cancel`).set(donor.auth).send({ reason: 'staff shortage' }).expect(204);
    expect(await request(rid)).toMatchObject({ status: 'OPEN', quantity_committed: 0 });
  });

  it('expires unconfirmed offers and past requests', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const rid = await createAssistanceRequest(h, ngo, cooked);
    const o = await offer(h, donor, rid, 50);
    await h.http.patch(`/api/offers/${o}/accept`).set(ngo.auth).send({}).expect(200);
    await h.ctx.db.query(`UPDATE food_assistance_requests SET needed_from = now() - interval '3 hours', needed_until = now() - interval '1 hour' WHERE id = $1`, [rid]);
    const summary = await h.services.expiry.run();
    expect(summary.offersExpired).toBe(1);
    // Releasing the expired offer's commitment after the window closed already moves the request to EXPIRED.
    expect(await request(rid)).toMatchObject({ status: 'EXPIRED', quantity_committed: 0 });
    const offerRow = await h.ctx.db.query('SELECT status FROM assistance_offers WHERE id = $1', [o]);
    expect(offerRow.rows[0]?.status).toBe('EXPIRED');
  });

  it('proposes which offers to accept using the optimiser', async () => {
    const admin = await createAdmin(h);
    const { donor, ngo, cooked } = await approvedPair(h, admin);
    const d2 = await extraDonor(admin, cooked, 'Second Donor');
    const rid = await createAssistanceRequest(h, ngo, cooked, { quantityRequired: 70 });
    await offer(h, donor, rid, 50);
    await offer(h, d2, rid, 50);
    const p = await h.http.post('/api/matching/allocate').set(ngo.auth).send({ assistanceRequestId: rid }).expect(200);
    expect(p.body.data.totalAllocated).toBe(70);
    stub.mode = 'error500';
    const fallback = await h.http.post('/api/matching/allocate').set(ngo.auth).send({ assistanceRequestId: rid }).expect(200);
    expect(fallback.body.data.source).toBe('FALLBACK_FIRST_COME');
  });
});
