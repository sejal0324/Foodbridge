import type { AppConfig } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { haversineMeters, type MapsClient } from '../integrations/maps.js';
import { trackingRoom, type Realtime } from '../sockets/realtime.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import type { LatLng } from '../validators/common.js';
import { recordAudit } from './audit.service.js';
import type { SettingsService } from './settings.service.js';

export const RETENTION_JOB = 'purge-location-history';
const MAX_ACCEPTED_ACCURACY_M = 5000;
const MAX_PLAUSIBLE_SPEED_MPS = 70; // ~250 km/h: anything faster is a GPS glitch
const ETA_REFRESH_MS = 60_000;
const NEAR_DESTINATION_M = 150;

interface SessionRow {
  id: string;
  pickup_assignment_id: string;
  stage: 'TO_PICKUP' | 'TO_DESTINATION';
  tracked_user_id: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy_m: number | null;
  last_recorded_at: Date | null;
  dest_lat: number | null;
  dest_lng: number | null;
  total_distance_m: number;
  donor_id: string;
  donor_owner: string;
  ngo_id: string;
  ngo_owner: string;
  representative_id: string;
  rep_name: string;
  pickup_status: string;
}

const SESSION_SELECT = `
  SELECT s.id, s.pickup_assignment_id, s.stage, s.tracked_user_id, s.status, s.started_at, s.ended_at, s.end_reason,
         ST_Y(s.last_location::geometry) AS last_lat, ST_X(s.last_location::geometry) AS last_lng, s.last_accuracy_m, s.last_recorded_at,
         ST_Y(s.destination_location::geometry) AS dest_lat, ST_X(s.destination_location::geometry) AS dest_lng, s.total_distance_m,
         d.donor_id, dn.owner_user_id AS donor_owner, p.ngo_id, n.owner_user_id AS ngo_owner, p.representative_id, ru.full_name AS rep_name, p.status AS pickup_status
    FROM tracking_sessions s
    JOIN pickup_assignments p ON p.id = s.pickup_assignment_id
    JOIN donation_allocations a ON a.id = p.allocation_id
    JOIN donations d ON d.id = a.donation_id
    JOIN donors dn ON dn.id = d.donor_id
    JOIN ngos n ON n.id = p.ngo_id
    JOIN ngo_representatives r ON r.id = p.representative_id
    JOIN users ru ON ru.id = r.user_id`;

/**
 * LiveTrack: foreground browser GPS sharing during an authorised journey.
 * Only the assigned representative can publish positions, only with explicit
 * consent, only while the session is ACTIVE. Viewers see the last known
 * position with its timestamp; stale positions are labelled, never shown as live.
 */
export class TrackingService {
  private readonly etaCache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly maps: MapsClient,
    private readonly realtime: Realtime,
    private readonly logger: Logger,
  ) {}

  private find(q: Queryable, id: string) {
    return one<SessionRow>(q, `${SESSION_SELECT} WHERE s.id = $1`, [id]);
  }

  /** Who may view: the representative, the NGO owner, the donor (pickup leg only), admins (audited). */
  private async authorizeView(auth: AuthContext, s: SessionRow, actor: Actor): Promise<void> {
    if (auth.userId === s.tracked_user_id || (auth.role === 'NGO' && auth.ngoId === s.ngo_id)) return;
    if (auth.role === 'DONOR' && auth.donorId === s.donor_id && s.stage === 'TO_PICKUP') return;
    if (auth.role === 'ADMIN') {
      await this.db.query(`INSERT INTO tracking_events (session_id, event_type, actor_user_id) VALUES ($1, 'ADMIN_VIEWED', $2)`, [s.id, auth.userId]);
      await recordAudit(this.db, actor, { action: 'tracking.admin_viewed', entityType: 'tracking_session', entityId: s.id });
      return;
    }
    throw notFound('Tracking session');
  }

  private async view(s: SessionRow) {
    const staleAfter = await this.settings.get('tracking.stale_after_seconds');
    const ageSeconds = s.last_recorded_at ? Math.round((Date.now() - s.last_recorded_at.getTime()) / 1000) : null;
    const liveness = s.status !== 'ACTIVE' ? 'ENDED' : ageSeconds === null ? 'WAITING_FOR_FIRST_POSITION' : ageSeconds > staleAfter ? 'STALE' : 'LIVE';
    const last = s.last_lat === null || s.last_lng === null ? null : { lat: s.last_lat, lng: s.last_lng };
    const destination = s.dest_lat === null || s.dest_lng === null ? null : { lat: s.dest_lat, lng: s.dest_lng };
    let eta: unknown = null;
    if (s.status === 'ACTIVE' && last && destination) eta = await this.eta(s.id, last, destination);
    return {
      id: s.id,
      pickupId: s.pickup_assignment_id,
      stage: s.stage,
      status: s.status,
      liveness,
      lastPosition: last ? { ...last, accuracyM: s.last_accuracy_m, recordedAt: s.last_recorded_at, ageSeconds } : null,
      destination,
      eta,
      totalDistanceM: Math.round(s.total_distance_m),
      representativeName: s.rep_name,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      endReason: s.end_reason,
      staleAfterSeconds: staleAfter,
    };
  }

  /** Remaining distance/ETA (cached per session; road ETA only when Google Routes is configured). */
  private async eta(sessionId: string, from: LatLng, to: LatLng) {
    const cached = this.etaCache.get(sessionId);
    if (cached && Date.now() - cached.at < ETA_REFRESH_MS) return cached.value;
    const r = await this.maps.route(from, to);
    const value = { remainingDistanceM: r.distanceM, etaSeconds: r.durationS, source: r.source, note: r.note };
    this.etaCache.set(sessionId, { at: Date.now(), value });
    return value;
  }

  async start(auth: AuthContext, input: { pickupId: string; stage: 'TO_PICKUP' | 'TO_DESTINATION'; consent: boolean }, actor: Actor) {
    if (!input.consent) throw unprocessable('Location sharing requires your explicit consent.', 'CONSENT_REQUIRED');
    const sessionId = await this.db.transaction(async (tx) => {
      const p = await one<{ representative_id: string; status: string; allocation_id: string; pickup_lat: number; pickup_lng: number; dest_lat: number | null; dest_lng: number | null; ngo_lat: number | null; ngo_lng: number | null; donation_id: string }>(
        tx,
        `SELECT p.representative_id, p.status, p.allocation_id, ST_Y(d.location::geometry) AS pickup_lat, ST_X(d.location::geometry) AS pickup_lng,
                ST_Y(p.destination_location::geometry) AS dest_lat, ST_X(p.destination_location::geometry) AS dest_lng,
                ST_Y(n.location::geometry) AS ngo_lat, ST_X(n.location::geometry) AS ngo_lng, d.id AS donation_id
           FROM pickup_assignments p JOIN donation_allocations a ON a.id = p.allocation_id JOIN donations d ON d.id = a.donation_id JOIN ngos n ON n.id = p.ngo_id
          WHERE p.id = $1 FOR UPDATE OF p`,
        [input.pickupId],
      );
      if (!p || p.representative_id !== auth.representativeId) throw notFound('Pickup');
      if (!auth.representativeActive) throw forbidden('Your representative authorisation is not active.', 'REPRESENTATIVE_INACTIVE');
      const allowed = input.stage === 'TO_PICKUP' ? ['ASSIGNED', 'EN_ROUTE'] : ['HANDED_OVER', 'IN_TRANSIT'];
      if (!allowed.includes(p.status)) {
        throw conflict(input.stage === 'TO_PICKUP' ? 'Pickup tracking is only for pickups that have not been collected yet.' : 'Delivery tracking starts after a confirmed handover.', 'TRACKING_NOT_ALLOWED');
      }
      const destination = input.stage === 'TO_PICKUP' ? { lat: p.pickup_lat, lng: p.pickup_lng } : p.dest_lat !== null && p.dest_lng !== null ? { lat: p.dest_lat, lng: p.dest_lng } : p.ngo_lat !== null && p.ngo_lng !== null ? { lat: p.ngo_lat, lng: p.ngo_lng } : null;
      const existing = await one<{ id: string }>(tx, `SELECT id FROM tracking_sessions WHERE pickup_assignment_id = $1 AND stage = $2 AND status = 'ACTIVE'`, [input.pickupId, input.stage]);
      if (existing) return existing.id;
      const s = await one<{ id: string }>(
        tx,
        `INSERT INTO tracking_sessions (pickup_assignment_id, stage, tracked_user_id, consent_given_at, destination_location)
         VALUES ($1, $2, $3, now(), CASE WHEN $4::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography END) RETURNING id`,
        [input.pickupId, input.stage, auth.userId, destination?.lat ?? null, destination?.lng ?? null],
      );
      await tx.query(`INSERT INTO tracking_events (session_id, event_type, actor_user_id, metadata) VALUES ($1, 'STARTED', $2, $3)`, [s?.id, auth.userId, JSON.stringify({ consent: true })]);
      if (input.stage === 'TO_PICKUP' && p.status === 'ASSIGNED') await tx.query(`UPDATE pickup_assignments SET status = 'EN_ROUTE' WHERE id = $1`, [input.pickupId]);
      if (input.stage === 'TO_DESTINATION' && p.status === 'HANDED_OVER') {
        await tx.query(`UPDATE pickup_assignments SET status = 'IN_TRANSIT' WHERE id = $1`, [input.pickupId]);
        await tx.query(`UPDATE donation_allocations SET status = 'IN_TRANSIT' WHERE id = $1 AND status = 'PICKED_UP'`, [p.allocation_id]);
      }
      await recordAudit(tx, actor, { action: 'tracking.started', entityType: 'tracking_session', entityId: s?.id, metadata: { stage: input.stage, consent: true } });
      return s?.id as string;
    });
    return this.getSession(auth, sessionId, actor);
  }

  async getSession(auth: AuthContext, id: string, actor: Actor) {
    const s = await this.find(this.db, id);
    if (!s) throw notFound('Tracking session');
    await this.authorizeView(auth, s, actor);
    return this.view(s);
  }

  /** Accepts a position from the tracked representative only, validates it, persists it, then broadcasts it. */
  async recordLocation(auth: AuthContext, input: { sessionId: string; location: LatLng; accuracyM?: number | undefined; heading?: number | undefined; speedMps?: number | undefined; recordedAt: Date }) {
    const s = await this.find(this.db, input.sessionId);
    if (!s || s.tracked_user_id !== auth.userId) throw notFound('Tracking session');
    if (s.status !== 'ACTIVE') throw conflict('This tracking session has ended.', 'TRACKING_ENDED');
    if (input.recordedAt.getTime() > Date.now() + 60_000) throw unprocessable('recordedAt is in the future.', 'INVALID_TIMESTAMP');
    if (input.recordedAt.getTime() < Date.now() - 15 * 60_000) throw unprocessable('Position is too old to be useful.', 'POSITION_TOO_OLD');
    if (input.accuracyM !== undefined && input.accuracyM > MAX_ACCEPTED_ACCURACY_M) throw unprocessable('Position accuracy is too low to share.', 'ACCURACY_TOO_LOW');
    if (s.last_recorded_at && input.recordedAt <= s.last_recorded_at) return { accepted: false, reason: 'out-of-order position ignored' };
    let segment = 0;
    if (s.last_lat !== null && s.last_lng !== null && s.last_recorded_at) {
      segment = haversineMeters({ lat: s.last_lat, lng: s.last_lng }, input.location);
      const seconds = Math.max(1, (input.recordedAt.getTime() - s.last_recorded_at.getTime()) / 1000);
      if (segment / seconds > MAX_PLAUSIBLE_SPEED_MPS) return { accepted: false, reason: 'implausible jump ignored' };
    }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO location_updates (session_id, location, accuracy_m, heading, speed_mps, recorded_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7)`,
        [s.id, input.location.lng, input.location.lat, input.accuracyM ?? null, input.heading ?? null, input.speedMps ?? null, input.recordedAt],
      );
      await tx.query(
        `UPDATE tracking_sessions SET last_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, last_accuracy_m = $4,
                last_recorded_at = $5, total_distance_m = total_distance_m + $6 WHERE id = $1`,
        [s.id, input.location.lng, input.location.lat, input.accuracyM ?? null, input.recordedAt, segment],
      );
      if (s.dest_lat !== null && s.dest_lng !== null && haversineMeters(input.location, { lat: s.dest_lat, lng: s.dest_lng }) < NEAR_DESTINATION_M) {
        await tx.query(
          `INSERT INTO tracking_events (session_id, event_type, actor_user_id)
           SELECT $1, 'NEAR_DESTINATION', $2 WHERE NOT EXISTS (SELECT 1 FROM tracking_events WHERE session_id = $1 AND event_type = 'NEAR_DESTINATION')`,
          [s.id, auth.userId],
        );
      }
    });
    const view = await this.view((await this.find(this.db, s.id)) as SessionRow);
    // GPS arrival never implies handover or delivery: those need human confirmation.
    this.realtime.toRoom(trackingRoom(s.id), 'tracking:location', view);
    return { accepted: true, session: view };
  }

  async recordEvent(auth: AuthContext, sessionOrPickup: { sessionId?: string | undefined; pickupId?: string | undefined }, type: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'DISCONNECTED' | 'RECONNECTED', detail?: string) {
    if (sessionOrPickup.sessionId) {
      const s = await this.find(this.db, sessionOrPickup.sessionId);
      if (!s || s.tracked_user_id !== auth.userId) throw notFound('Tracking session');
    } else if (sessionOrPickup.pickupId) {
      const p = await one<{ representative_id: string }>(this.db, 'SELECT representative_id FROM pickup_assignments WHERE id = $1', [sessionOrPickup.pickupId]);
      if (!p || p.representative_id !== auth.representativeId) throw notFound('Pickup');
    } else throw unprocessable('sessionId or pickupId is required.');
    await this.db.query(`INSERT INTO tracking_events (session_id, pickup_assignment_id, event_type, actor_user_id, metadata) VALUES ($1, $2, $3, $4, $5)`, [
      sessionOrPickup.sessionId ?? null,
      sessionOrPickup.pickupId ?? null,
      type,
      auth.userId,
      detail ? JSON.stringify({ detail: detail.slice(0, 300) }) : null,
    ]);
    if (sessionOrPickup.sessionId) this.realtime.toRoom(trackingRoom(sessionOrPickup.sessionId), 'tracking:event', { type, at: new Date() });
    return { recorded: true };
  }

  async stop(auth: AuthContext, sessionId: string, reason: string, actor: Actor) {
    const s = await this.find(this.db, sessionId);
    if (!s || (s.tracked_user_id !== auth.userId && !(auth.role === 'NGO' && auth.ngoId === s.ngo_id))) throw notFound('Tracking session');
    if (s.status !== 'ACTIVE') return this.view(s);
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE tracking_sessions SET status = 'ENDED', ended_at = now(), end_reason = $2 WHERE id = $1 AND status = 'ACTIVE'`, [sessionId, reason]);
      await tx.query(`INSERT INTO tracking_events (session_id, event_type, actor_user_id) VALUES ($1, 'STOPPED', $2)`, [sessionId, auth.userId]);
      await recordAudit(tx, actor, { action: 'tracking.stopped', entityType: 'tracking_session', entityId: sessionId, metadata: { reason } });
    });
    const view = await this.view((await this.find(this.db, sessionId)) as SessionRow);
    this.realtime.toRoom(trackingRoom(sessionId), 'tracking:ended', view);
    return view;
  }

  /** Recent path (bounded) for drawing the breadcrumb on the map. */
  async path(auth: AuthContext, sessionId: string, actor: Actor) {
    const s = await this.find(this.db, sessionId);
    if (!s) throw notFound('Tracking session');
    await this.authorizeView(auth, s, actor);
    return many(
      this.db,
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, accuracy_m AS "accuracyM", recorded_at AS "recordedAt"
         FROM location_updates WHERE session_id = $1 ORDER BY recorded_at DESC LIMIT 500`,
      [sessionId],
    );
  }

  /** Active sessions for admins (overview, audited when opened individually). */
  async activeSessions() {
    return many(
      this.db,
      `SELECT s.id, s.stage, s.started_at AS "startedAt", s.last_recorded_at AS "lastRecordedAt", ru.full_name AS "representativeName", n.organization_name AS "ngoName"
         FROM tracking_sessions s JOIN pickup_assignments p ON p.id = s.pickup_assignment_id JOIN ngo_representatives r ON r.id = p.representative_id
         JOIN users ru ON ru.id = r.user_id JOIN ngos n ON n.id = p.ngo_id WHERE s.status = 'ACTIVE' ORDER BY s.started_at DESC`,
    );
  }

  /** Retention: deletes raw GPS points of sessions ended more than LOCATION_RETENTION_DAYS ago and clears their last position. */
  async purgeExpiredLocations(): Promise<{ sessions: number; points: number }> {
    const days = this.config.retention.locationDays;
    const sessions = await many<{ id: string }>(
      this.db,
      `SELECT id FROM tracking_sessions WHERE status <> 'ACTIVE' AND points_purged_at IS NULL AND ended_at < now() - make_interval(days => $1)`,
      [days],
    );
    let points = 0;
    for (const s of sessions) {
      const res = await this.db.query('DELETE FROM location_updates WHERE session_id = $1', [s.id]);
      points += res.rowCount ?? 0;
      await this.db.query('UPDATE tracking_sessions SET last_location = NULL, last_accuracy_m = NULL, points_purged_at = now() WHERE id = $1', [s.id]);
    }
    // Sessions abandoned without being stopped are ended after 12 hours of silence.
    await this.db.query(
      `UPDATE tracking_sessions SET status = 'EXPIRED', ended_at = now(), end_reason = 'no updates for 12 hours'
        WHERE status = 'ACTIVE' AND COALESCE(last_recorded_at, started_at) < now() - interval '12 hours'`,
    );
    if (points > 0) this.logger.info({ sessions: sessions.length, points }, 'purged expired location history');
    return { sessions: sessions.length, points };
  }
}
