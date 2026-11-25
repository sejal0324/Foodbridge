import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { trackingRoom } from '../src/sockets/realtime.js';
import { approve, registerDonor } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { confirmBoth, pickupFixture, verifyPickup } from './helpers/pickup.js';

let h: Harness;
beforeEach(async () => {
  h ??= await createHarness();
  await resetDatabase(h.ctx.db);
  h.realtime.events.length = 0;
});
afterAll(() => h.close());

const now = (offsetS = 0) => new Date(Date.now() + offsetS * 1000).toISOString();

describe('Scenario E / LiveTrack: consent, authorisation, liveness and retention', () => {
  it('requires explicit consent and only lets the assigned representative publish positions', async () => {
    const f = await pickupFixture(h);
    await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_PICKUP', consent: false }).expect(422);
    const started = await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_PICKUP', consent: true }).expect(201);
    const sessionId = started.body.data.id as string;
    expect(started.body.data.liveness).toBe('WAITING_FOR_FIRST_POSITION');
    const pickup = await h.ctx.db.query('SELECT status FROM pickup_assignments WHERE id = $1', [f.pickupId]);
    expect(pickup.rows[0]?.status).toBe('EN_ROUTE');

    // Donors cannot publish positions.
    await h.http.post('/api/tracking/location').set(f.donor.auth).send({ sessionId, lat: 18.59, lng: 73.74, accuracyM: 10, recordedAt: now() }).expect(403);
    const res = await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 18.5913, lng: 73.7389, accuracyM: 12, recordedAt: now() }).expect(200);
    expect(res.body.data.accepted).toBe(true);
    expect(res.body.data.session.liveness).toBe('LIVE');
    // Persisted before broadcast, then emitted only to the session room.
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM location_updates')).rows[0]?.n).toBe(1);
    expect(h.realtime.events.find((e) => e.event === 'tracking:location')?.target).toBe(trackingRoom(sessionId));
    // Without road routing configured, ETA is not invented.
    expect(res.body.data.session.eta).toMatchObject({ etaSeconds: null, source: 'STRAIGHT_LINE_ESTIMATE' });
  });

  it('lets the donor watch the pickup leg but not the delivery leg, and hides sessions from unrelated users', async () => {
    const f = await pickupFixture(h);
    const s = await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_PICKUP', consent: true }).expect(201);
    await h.http.get(`/api/tracking/${s.body.data.id}`).set(f.donor.auth).expect(200);
    const stranger = await registerDonor(h, { name: 'Stranger Foods' });
    await approve(h, f.admin, 'donor', stranger.orgId);
    await h.http.get(`/api/tracking/${s.body.data.id}`).set(stranger.auth).expect(404);
    await h.http.get(`/api/tracking/${s.body.data.id}`).set(f.admin.auth).expect(200);
    const audit = await h.ctx.db.query(`SELECT count(*) AS n FROM audit_logs WHERE action = 'tracking.admin_viewed'`);
    expect(audit.rows[0]?.n).toBe(1);

    await verifyPickup(h, f);
    await confirmBoth(h, f, 40, 40);
    const leg2 = await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_DESTINATION', consent: true }).expect(201);
    await h.http.get(`/api/tracking/${leg2.body.data.id}`).set(f.donor.auth).expect(404);
    const alloc = await h.ctx.db.query('SELECT status FROM donation_allocations WHERE id = $1', [f.allocationId]);
    expect(alloc.rows[0]?.status).toBe('IN_TRANSIT');
  });

  it('labels an old position as STALE (never live) and rejects implausible or out-of-order points', async () => {
    const f = await pickupFixture(h);
    const s = await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_PICKUP', consent: true }).expect(201);
    const sessionId = s.body.data.id as string;
    await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 18.5913, lng: 73.7389, accuracyM: 10, recordedAt: now(-120) }).expect(200);
    const view = await h.http.get(`/api/tracking/${sessionId}`).set(f.donor.auth).expect(200);
    expect(view.body.data.liveness).toBe('STALE');
    expect(view.body.data.lastPosition.ageSeconds).toBeGreaterThanOrEqual(119);
    // 50 km in 10 seconds is a GPS glitch.
    const jump = await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 19.05, lng: 73.74, accuracyM: 10, recordedAt: now(-110) }).expect(200);
    expect(jump.body.data).toMatchObject({ accepted: false });
    const older = await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 18.5914, lng: 73.7389, recordedAt: now(-200) }).expect(200);
    expect(older.body.data.accepted).toBe(false);
    await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 18.59, lng: 73.74, accuracyM: 99999, recordedAt: now() }).expect(422);
  });

  it('records permission-denied events, stops tracking, and purges raw GPS after the retention period', async () => {
    const f = await pickupFixture(h);
    await h.http.post('/api/tracking/events').set(f.ngo.auth).send({ pickupId: f.pickupId, type: 'PERMISSION_DENIED', detail: 'User denied geolocation' }).expect(200);
    const s = await h.http.post('/api/tracking/start').set(f.ngo.auth).send({ pickupId: f.pickupId, stage: 'TO_PICKUP', consent: true }).expect(201);
    const sessionId = s.body.data.id as string;
    await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 18.5913, lng: 73.7389, accuracyM: 10, recordedAt: now() }).expect(200);
    const stopped = await h.http.post('/api/tracking/stop').set(f.ngo.auth).send({ sessionId, reason: 'arrived' }).expect(200);
    expect(stopped.body.data.liveness).toBe('ENDED');
    await h.http.post('/api/tracking/location').set(f.ngo.auth).send({ sessionId, lat: 18.5913, lng: 73.7389, recordedAt: now(1) }).expect(409);
    await h.ctx.db.query(`UPDATE tracking_sessions SET ended_at = now() - interval '40 days' WHERE id = $1`, [sessionId]);
    const purged = await h.services.tracking.purgeExpiredLocations();
    expect(purged).toMatchObject({ sessions: 1, points: 1 });
    const row = await h.ctx.db.query('SELECT last_location, points_purged_at FROM tracking_sessions WHERE id = $1', [sessionId]);
    expect(row.rows[0]?.last_location).toBeNull();
    expect(row.rows[0]?.points_purged_at).not.toBeNull();
    const events = await h.ctx.db.query(`SELECT event_type FROM tracking_events ORDER BY id`);
    expect(events.rows.map((e) => e.event_type)).toEqual(['PERMISSION_DENIED', 'STARTED', 'STOPPED']);
  });
});
