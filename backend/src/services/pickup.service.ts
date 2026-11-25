import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { assertTransition } from '../domain/state-machines.js';
import { type Actor, type AuthContext, scopedNgoId } from '../types/auth.js';
import { randomToken, sha256Hex } from '../utils/crypto.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { formatDateTime, unitLabel } from '../utils/format.js';
import type { LatLng } from '../validators/common.js';
import type { AllocationService } from './allocation.service.js';
import { recordAudit } from './audit.service.js';
import type { BillingService } from './billing.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';
import { trackingRoom, type Realtime } from '../sockets/realtime.js';
import type { RewardService } from './reward.service.js';
import type { SettingsService } from './settings.service.js';

const TOKEN_PREFIX = 'FBP1.';
type Viewer = 'DONOR' | 'NGO_OWNER' | 'REPRESENTATIVE' | 'ADMIN';

interface PickupRow {
  id: string;
  allocation_id: string;
  ngo_id: string;
  ngo_name: string;
  ngo_owner: string;
  representative_id: string;
  rep_user_id: string;
  rep_name: string;
  rep_phone: string | null;
  rep_status: string;
  rep_doc_type: string;
  rep_doc_last4: string;
  rep_has_photo: boolean;
  status: string;
  scheduled_pickup_at: Date | null;
  dest_lat: number | null;
  dest_lng: number | null;
  destination_address: string | null;
  qr_verified_at: Date | null;
  identity_confirmed_at: Date | null;
  handed_over_at: Date | null;
  delivered_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  allocation_quantity: number;
  allocation_status: string;
  allocation_source: string;
  assistance_offer_id: string | null;
  donation_id: string;
  donor_id: string;
  donor_name: string;
  donor_owner: string;
  food_name: string;
  unit: string;
  dietary_type: string;
  pickup_deadline: Date;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
}

const PICKUP_SELECT = `
  SELECT p.id, p.allocation_id, p.ngo_id, n.organization_name AS ngo_name, n.owner_user_id AS ngo_owner, p.representative_id,
         r.user_id AS rep_user_id, ru.full_name AS rep_name, ru.phone AS rep_phone, r.status AS rep_status,
         r.id_document_type AS rep_doc_type, r.id_document_last4 AS rep_doc_last4, (r.photo_storage_key IS NOT NULL) AS rep_has_photo,
         p.status, p.scheduled_pickup_at, ST_Y(p.destination_location::geometry) AS dest_lat, ST_X(p.destination_location::geometry) AS dest_lng,
         p.destination_address, p.qr_verified_at, p.identity_confirmed_at, p.handed_over_at, p.delivered_at, p.cancel_reason, p.created_at,
         a.quantity AS allocation_quantity, a.status AS allocation_status, a.source AS allocation_source, a.assistance_offer_id,
         d.id AS donation_id, d.donor_id, dn.business_name AS donor_name, dn.owner_user_id AS donor_owner, d.food_name, d.unit, d.dietary_type,
         d.pickup_deadline, d.address AS pickup_address, ST_Y(d.location::geometry) AS pickup_lat, ST_X(d.location::geometry) AS pickup_lng
    FROM pickup_assignments p
    JOIN ngos n ON n.id = p.ngo_id
    JOIN ngo_representatives r ON r.id = p.representative_id
    JOIN users ru ON ru.id = r.user_id
    JOIN donation_allocations a ON a.id = p.allocation_id
    JOIN donations d ON d.id = a.donation_id
    JOIN donors dn ON dn.id = d.donor_id`;

const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}••••••${p.slice(-2)}` : null);

interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Pickup verification (QR pass + physical photo-ID check) and two-way handover.
 * Points and fees are recorded only when both sides confirm the same quantity.
 */
export class PickupService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly allocations: AllocationService,
    private readonly rewards: RewardService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationService,
    private readonly realtime: Realtime,
  ) {}

  /** Ends active tracking for a pickup (optionally one stage) and returns the session ids, published after commit. */
  private async endTracking(tx: Queryable, pickupId: string, reason: string, stage?: 'TO_PICKUP' | 'TO_DESTINATION'): Promise<string[]> {
    const rows = await many<{ id: string }>(
      tx,
      `UPDATE tracking_sessions SET status = 'ENDED', ended_at = now(), end_reason = $2
        WHERE pickup_assignment_id = $1 AND status = 'ACTIVE' AND ($3::text IS NULL OR stage = $3) RETURNING id`,
      [pickupId, reason, stage ?? null],
    );
    return rows.map((r) => r.id);
  }

  /** Tells live viewers that tracking stopped (best-effort; the session view says ENDED on refetch anyway). */
  private publishTrackingEnded(sessionIds: string[]): void {
    for (const sessionId of sessionIds) this.realtime.toRoom(trackingRoom(sessionId), 'tracking:ended', { sessionId, liveness: 'ENDED', at: new Date() });
  }

  private async find(q: Queryable, id: string): Promise<PickupRow | undefined> {
    return one<PickupRow>(q, `${PICKUP_SELECT} WHERE p.id = $1`, [id]);
  }

  private viewer(auth: AuthContext, p: PickupRow): Viewer {
    if (auth.role === 'ADMIN') return 'ADMIN';
    if (auth.role === 'DONOR' && auth.donorId === p.donor_id) return 'DONOR';
    if (auth.role === 'NGO' && auth.representativeId === p.representative_id && p.rep_status === 'ACTIVE') return 'REPRESENTATIVE';
    if (auth.role === 'NGO' && auth.ngoId === p.ngo_id) return 'NGO_OWNER';
    throw notFound('Pickup');
  }

  private toDto(p: PickupRow, viewer: Viewer, extra: Record<string, unknown> = {}) {
    return {
      id: p.id,
      allocationId: p.allocation_id,
      status: p.status,
      viewer,
      donation: {
        id: p.donation_id,
        foodName: p.food_name,
        unit: p.unit,
        dietaryType: p.dietary_type,
        quantity: p.allocation_quantity,
        pickupDeadline: p.pickup_deadline,
        address: p.pickup_address,
        location: { lat: p.pickup_lat, lng: p.pickup_lng },
      },
      donor: { id: p.donor_id, name: p.donor_name },
      ngo: { id: p.ngo_id, name: p.ngo_name },
      representative: {
        id: p.representative_id,
        name: p.rep_name,
        phone: viewer === 'DONOR' ? maskPhone(p.rep_phone) : p.rep_phone,
        idDocumentType: p.rep_doc_type,
        idDocumentLast4: p.rep_doc_last4,
        hasPhoto: p.rep_has_photo,
        status: p.rep_status,
      },
      scheduledPickupAt: p.scheduled_pickup_at,
      destination: p.dest_lat === null ? null : { location: { lat: p.dest_lat, lng: p.dest_lng }, address: p.destination_address },
      checks: { qrVerifiedAt: p.qr_verified_at, identityConfirmedAt: p.identity_confirmed_at },
      handedOverAt: p.handed_over_at,
      deliveredAt: p.delivered_at,
      cancelReason: p.cancel_reason,
      allocationStatus: p.allocation_status,
      createdAt: p.created_at,
      ...extra,
    };
  }

  private async logVerification(
    q: Queryable,
    pickupId: string | null,
    method: 'QR' | 'IDENTITY_CHECK',
    result: 'SUCCESS' | 'FAILURE',
    reason: string | null,
    auth: AuthContext,
    meta: ClientMeta,
  ) {
    await q.query(
      `INSERT INTO pickup_verifications (pickup_assignment_id, method, result, failure_reason, actor_user_id, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pickupId, method, result, reason, auth.userId, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
    );
    if (result === 'FAILURE') {
      await recordAudit(q, { type: 'USER', userId: auth.userId, role: auth.role, ip: meta.ip, userAgent: meta.userAgent }, {
        action: `pickup.${method.toLowerCase()}_rejected`,
        entityType: 'pickup',
        entityId: pickupId,
        metadata: { reason },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Assignment
  // -------------------------------------------------------------------------
  async assign(
    auth: AuthContext,
    input: { allocationId: string; representativeId: string; scheduledPickupAt?: Date | undefined; destination?: { location: LatLng; address: string } | undefined },
    actor: Actor,
  ) {
    if (!auth.ngoId) throw forbidden();
    const notices: (NotificationRow | null)[] = [];
    const ended: string[] = [];
    const pickupId = await this.db.transaction(async (tx) => {
      const pre = await one<{ donation_id: string }>(tx, 'SELECT donation_id FROM donation_allocations WHERE id = $1', [input.allocationId]);
      if (!pre) throw notFound('Allocation');
      await tx.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [pre.donation_id]);
      const a = await one<{ ngo_id: string; status: string; assistance_offer_id: string | null; donation_id: string }>(
        tx,
        'SELECT ngo_id, status, assistance_offer_id, donation_id FROM donation_allocations WHERE id = $1 FOR UPDATE',
        [input.allocationId],
      );
      if (!a || a.ngo_id !== auth.ngoId) throw notFound('Allocation');
      if (!['RESERVED', 'PICKUP_ASSIGNED'].includes(a.status)) throw conflict(`An allocation in status ${a.status} cannot be (re)assigned.`, 'ALLOCATION_NOT_ASSIGNABLE');
      const rep = await one<{ ngo_id: string; status: string; account_status: string; phone: string | null; user_id: string; full_name: string }>(
        tx,
        `SELECT r.ngo_id, r.status, u.account_status, u.phone, r.user_id, u.full_name FROM ngo_representatives r JOIN users u ON u.id = r.user_id
          WHERE r.id = $1 AND r.deleted_at IS NULL`,
        [input.representativeId],
      );
      if (!rep || rep.ngo_id !== auth.ngoId) throw notFound('Representative');
      if (rep.status !== 'ACTIVE') throw unprocessable('This representative is not active.', 'REPRESENTATIVE_INACTIVE');
      // Reassignment: cancel the previous active pickup and revoke its credentials.
      const previous = await many<{ id: string; status: string }>(
        tx,
        `SELECT id, status FROM pickup_assignments WHERE allocation_id = $1 AND status NOT IN ('CANCELLED','FAILED','DELIVERED') FOR UPDATE`,
        [input.allocationId],
      );
      for (const prev of previous) {
        if (!['ASSIGNED', 'EN_ROUTE'].includes(prev.status)) throw conflict('Verification has started for the current pickup; it can no longer be reassigned.', 'PICKUP_IN_PROGRESS');
        await tx.query(`UPDATE pickup_assignments SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'reassigned' WHERE id = $1`, [prev.id]);
        await tx.query('UPDATE pickup_tokens SET revoked_at = now() WHERE pickup_assignment_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL', [prev.id]);
        ended.push(...(await this.endTracking(tx, prev.id, 'reassigned')));
      }
      const p = await one<{ id: string }>(
        tx,
        `INSERT INTO pickup_assignments (allocation_id, ngo_id, representative_id, assigned_by, scheduled_pickup_at, destination_location, destination_address)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END, $8) RETURNING id`,
        [
          input.allocationId,
          auth.ngoId,
          input.representativeId,
          auth.userId,
          input.scheduledPickupAt ?? null,
          input.destination?.location.lat ?? null,
          input.destination?.location.lng ?? null,
          input.destination?.address ?? null,
        ],
      );
      if (!p) throw new Error('pickup insert failed');
      if (a.status === 'RESERVED') {
        assertTransition('allocation', a.status, 'PICKUP_ASSIGNED');
        await tx.query(`UPDATE donation_allocations SET status = 'PICKUP_ASSIGNED' WHERE id = $1`, [input.allocationId]);
        if (a.assistance_offer_id) await tx.query(`UPDATE assistance_offers SET status = 'PICKUP_ASSIGNED' WHERE id = $1 AND status = 'RESERVED'`, [a.assistance_offer_id]);
      }
      await this.allocations.rollupDonationStatus(tx, a.donation_id, auth.userId, 'pickup assigned');
      await recordAudit(tx, actor, { action: 'pickup.assigned', entityType: 'pickup', entityId: p.id, metadata: { allocationId: input.allocationId, representativeId: input.representativeId, reassigned: previous.length > 0 } });
      const row = (await this.find(tx, p.id)) as PickupRow;
      notices.push(
        await this.notifications.create(tx, {
          userId: row.donor_owner,
          type: 'PICKUP_ASSIGNED',
          title: 'Representative assigned',
          body: `${row.rep_name} from ${row.ngo_name} will collect ${row.allocation_quantity} ${unitLabel(row.unit, row.allocation_quantity)} of ${row.food_name}${row.scheduled_pickup_at ? ` around ${formatDateTime(row.scheduled_pickup_at)}` : ''}. Scan their QR pass at pickup.`,
          linkPath: `/donor/pickups/${p.id}`,
          priority: 'HIGH',
          dedupeKey: `pickup-assigned:${p.id}`,
          email: true,
        }),
      );
      if (rep.user_id !== auth.userId) {
        notices.push(
          await this.notifications.create(tx, {
            userId: rep.user_id,
            type: 'PICKUP_ASSIGNED_TO_YOU',
            title: 'New pickup assigned to you',
            body: `Collect ${row.allocation_quantity} ${unitLabel(row.unit, row.allocation_quantity)} of ${row.food_name} from ${row.donor_name}, ${row.pickup_address}, before ${formatDateTime(row.pickup_deadline)}.`,
            linkPath: `/ngo/pickups/${p.id}`,
            priority: 'HIGH',
            dedupeKey: `pickup-assigned-rep:${p.id}`,
          }),
        );
      }
      return p.id;
    });
    this.notifications.publish(notices);
    this.publishTrackingEnded(ended);
    return this.get(auth, pickupId);
  }

  async list(auth: AuthContext, filter: { status?: string | undefined; active?: boolean | undefined }) {
    const where: string[] = [];
    const v: unknown[] = [];
    if (auth.role === 'DONOR') where.push(`d.donor_id = $${v.push(auth.donorId)}`);
    else if (auth.role === 'NGO') {
      if (auth.ngoId) where.push(`p.ngo_id = $${v.push(auth.ngoId)}`);
      else where.push(`p.representative_id = $${v.push(auth.representativeId)}`);
    }
    if (filter.status) where.push(`p.status = $${v.push(filter.status)}`);
    if (filter.active) where.push(`p.status IN ('ASSIGNED','EN_ROUTE','VERIFIED','HANDED_OVER','IN_TRANSIT','DISPUTED')`);
    const rows = await many<PickupRow>(this.db, `${PICKUP_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT 200`, v);
    return rows.map((r) => this.toDto(r, this.viewer(auth, r)));
  }

  async get(auth: AuthContext, id: string) {
    const p = await this.find(this.db, id);
    if (!p) throw notFound('Pickup');
    const viewer = this.viewer(auth, p);
    const handover = await one<{ status: string; donor_confirmed_quantity: number | null; ngo_received_quantity: number | null; donor_confirmed_at: Date | null; ngo_confirmed_at: Date | null }>(
      this.db,
      'SELECT status, donor_confirmed_quantity, ngo_received_quantity, donor_confirmed_at, ngo_confirmed_at FROM handover_records WHERE pickup_assignment_id = $1',
      [id],
    );
    const sessions = await many<{ id: string; stage: string; status: string; last_recorded_at: Date | null }>(
      this.db,
      'SELECT id, stage, status, last_recorded_at FROM tracking_sessions WHERE pickup_assignment_id = $1 ORDER BY started_at',
      [id],
    );
    const delivery = await one<{ delivered_quantity: number; confirmed_at: Date; beneficiaries_served: number | null }>(
      this.db,
      'SELECT delivered_quantity, confirmed_at, beneficiaries_served FROM delivery_confirmations WHERE pickup_assignment_id = $1',
      [id],
    );
    return this.toDto(p, viewer, {
      handover: handover
        ? {
            status: handover.status,
            donorConfirmedQuantity: handover.donor_confirmed_quantity,
            ngoReceivedQuantity: handover.ngo_received_quantity,
            donorConfirmedAt: handover.donor_confirmed_at,
            ngoConfirmedAt: handover.ngo_confirmed_at,
          }
        : null,
      delivery: delivery ? { deliveredQuantity: delivery.delivered_quantity, confirmedAt: delivery.confirmed_at, beneficiariesServed: delivery.beneficiaries_served } : null,
      trackingSessions: sessions.map((s) => ({ id: s.id, stage: s.stage, status: s.status, lastRecordedAt: s.last_recorded_at })),
    });
  }

  // -------------------------------------------------------------------------
  // QR pass (representative) and QR scan (donor)
  // -------------------------------------------------------------------------

  /** Only the assigned representative can generate their pass. The QR contains an opaque random token and no personal data. */
  async generatePass(auth: AuthContext, pickupId: string, actor: Actor) {
    const p = await this.find(this.db, pickupId);
    if (!p || auth.representativeId !== p.representative_id) throw notFound('Pickup');
    if (p.rep_status !== 'ACTIVE') throw forbidden('Your representative authorisation is not active.', 'REPRESENTATIVE_INACTIVE');
    if (!['ASSIGNED', 'EN_ROUTE'].includes(p.status)) throw conflict(`A pass cannot be generated for a pickup in status ${p.status}.`, 'PICKUP_NOT_ACTIVE');
    const ttl = await this.settings.get('pickup.qr_ttl_minutes');
    const token = `${TOKEN_PREFIX}${randomToken(32)}`;
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE pickup_tokens SET revoked_at = now() WHERE pickup_assignment_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL', [pickupId]);
      await tx.query('INSERT INTO pickup_tokens (pickup_assignment_id, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4)', [pickupId, sha256Hex(token), expiresAt, auth.userId]);
      await recordAudit(tx, actor, { action: 'pickup.pass_generated', entityType: 'pickup', entityId: pickupId, metadata: { expiresAt } });
    });
    return { pickupId, token, qrPayload: token, expiresAt, ttlMinutes: ttl };
  }

  /**
   * Donor scans the representative's QR. The token must exist, be unexpired,
   * unrevoked, unconsumed, belong to a pickup of this donor, and the
   * representative must still be active. It is consumed atomically (single
   * use). The donor then checks the representative's photo ID (confirmIdentity).
   */
  async verifyQr(auth: AuthContext, token: string, meta: ClientMeta) {
    if (!auth.donorId) throw forbidden();
    const reject = async (pickupId: string | null, reason: string, message: string) => {
      await this.logVerification(this.db, pickupId, 'QR', 'FAILURE', reason, auth, meta);
      throw new AppError(422, 'QR_REJECTED', message, { reason });
    };
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return reject(null, 'TOKEN_NOT_FOUND', 'This is not a valid FoodBridge pickup pass.');
    const hash = sha256Hex(token);
    const t = await one<{ id: string; pickup_assignment_id: string; expires_at: Date; consumed_at: Date | null; revoked_at: Date | null }>(
      this.db,
      'SELECT id, pickup_assignment_id, expires_at, consumed_at, revoked_at FROM pickup_tokens WHERE token_hash = $1',
      [hash],
    );
    if (!t) return reject(null, 'TOKEN_NOT_FOUND', 'This pickup pass is not recognised.');
    const p = (await this.find(this.db, t.pickup_assignment_id)) as PickupRow;
    if (p.donor_id !== auth.donorId) return reject(p.id, 'WRONG_DONOR', 'This pickup pass is for a different donor. Do not hand over food.');
    if (t.revoked_at) return reject(p.id, 'TOKEN_REVOKED', 'This pickup pass has been revoked. Ask the representative to generate a new one.');
    if (t.consumed_at) return reject(p.id, 'TOKEN_CONSUMED', 'This pickup pass has already been used.');
    if (t.expires_at <= new Date()) return reject(p.id, 'TOKEN_EXPIRED', 'This pickup pass has expired. Ask the representative to generate a new one.');
    if (p.rep_status !== 'ACTIVE') return reject(p.id, 'REPRESENTATIVE_INACTIVE', 'This representative is no longer authorised by the NGO. Do not hand over food.');
    if (!['ASSIGNED', 'EN_ROUTE'].includes(p.status)) return reject(p.id, 'PICKUP_NOT_ACTIVE', `This pickup is ${p.status.toLowerCase()} and cannot be verified.`);

    const consumed = await this.db.transaction(async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `UPDATE pickup_tokens SET consumed_at = now(), consumed_by = $2
          WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id`,
        [t.id, auth.userId],
      );
      if (!row) return false;
      await tx.query(`UPDATE pickup_assignments SET qr_verified_at = now() WHERE id = $1`, [p.id]);
      await this.logVerification(tx, p.id, 'QR', 'SUCCESS', null, auth, meta);
      await recordAudit(tx, { type: 'USER', userId: auth.userId, role: auth.role, ip: meta.ip, userAgent: meta.userAgent }, { action: 'pickup.qr_verified', entityType: 'pickup', entityId: p.id });
      return true;
    });
    // A concurrent scan consumed it first.
    if (!consumed) return reject(p.id, 'TOKEN_CONSUMED', 'This pickup pass has already been used.');
    return { pickup: await this.get(auth, p.id) };
  }

  /** Donor confirms they physically checked the representative's identity (name, photo, ID last 4). */
  async confirmIdentity(auth: AuthContext, pickupId: string, meta: ClientMeta) {
    await this.db.transaction(async (tx) => {
      const p = await this.find(tx, pickupId);
      if (!p || p.donor_id !== auth.donorId) throw notFound('Pickup');
      if (!p.qr_verified_at) throw conflict('Verify the QR pass before confirming identity.', 'VERIFICATION_INCOMPLETE');
      if (p.rep_status !== 'ACTIVE') throw forbidden('This representative is no longer authorised by the NGO. Do not hand over food.', 'REPRESENTATIVE_INACTIVE');
      if (!['ASSIGNED', 'EN_ROUTE'].includes(p.status)) throw conflict(`This pickup is already ${p.status.toLowerCase()}.`, 'PICKUP_NOT_ACTIVE');
      assertTransition('pickup', p.status, 'VERIFIED');
      await tx.query(`UPDATE pickup_assignments SET identity_confirmed_at = now(), status = 'VERIFIED' WHERE id = $1`, [pickupId]);
      await this.logVerification(tx, pickupId, 'IDENTITY_CHECK', 'SUCCESS', null, auth, meta);
      await recordAudit(tx, { type: 'USER', userId: auth.userId, role: auth.role, ip: meta.ip, userAgent: meta.userAgent }, { action: 'pickup.identity_confirmed', entityType: 'pickup', entityId: pickupId });
    });
    return this.get(auth, pickupId);
  }

  // -------------------------------------------------------------------------
  // Two-way handover
  // -------------------------------------------------------------------------

  /**
   * Each side confirms the quantity independently. Equal quantities →
   * CONFIRMED (reward points + NGO fee recorded idempotently in the same
   * transaction). Different quantities → DISPUTED (no points, no fee).
   */
  async confirmHandover(auth: AuthContext, pickupId: string, quantity: number, notes: string | undefined, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    const ended: string[] = [];
    let outcome: 'WAITING' | 'CONFIRMED' | 'DISPUTED' = 'WAITING';
    await this.db.transaction(async (tx) => {
      const pre = await this.find(tx, pickupId);
      if (!pre) throw notFound('Pickup');
      const viewer = this.viewer(auth, pre);
      const side: 'DONOR' | 'NGO' | null = viewer === 'DONOR' ? 'DONOR' : viewer === 'REPRESENTATIVE' || viewer === 'NGO_OWNER' ? 'NGO' : null;
      if (!side) throw forbidden('Only the donor and the NGO can confirm a handover.');
      if (pre.rep_status !== 'ACTIVE') throw forbidden('This representative is no longer authorised by the NGO. Do not hand over food.', 'REPRESENTATIVE_INACTIVE');
      await tx.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [pre.donation_id]);
      await tx.query('SELECT 1 FROM donation_allocations WHERE id = $1 FOR UPDATE', [pre.allocation_id]);
      const p = (await one<{ status: string }>(tx, 'SELECT status FROM pickup_assignments WHERE id = $1 FOR UPDATE', [pickupId])) as { status: string };
      if (p.status !== 'VERIFIED') {
        throw conflict(
          p.status === 'ASSIGNED' || p.status === 'EN_ROUTE' ? 'The representative must be verified (QR pass and identity) before handover.' : `This pickup is already ${p.status.toLowerCase()}.`,
          'HANDOVER_NOT_ALLOWED',
        );
      }
      if (quantity > pre.allocation_quantity) throw unprocessable(`At most ${pre.allocation_quantity} were reserved for this pickup.`, 'QUANTITY_EXCEEDS_ALLOCATION');
      await tx.query(
        `INSERT INTO handover_records (pickup_assignment_id, allocation_id, status) VALUES ($1, $2, 'PENDING_DONOR') ON CONFLICT (pickup_assignment_id) DO NOTHING`,
        [pickupId, pre.allocation_id],
      );
      const h = (await one<{ id: string; status: string; donor_confirmed_quantity: number | null; ngo_received_quantity: number | null }>(
        tx,
        'SELECT id, status, donor_confirmed_quantity, ngo_received_quantity FROM handover_records WHERE pickup_assignment_id = $1 FOR UPDATE',
        [pickupId],
      )) as { id: string; status: string; donor_confirmed_quantity: number | null; ngo_received_quantity: number | null };
      if (side === 'DONOR' && h.donor_confirmed_quantity !== null) throw conflict('You have already confirmed this handover.', 'ALREADY_CONFIRMED');
      if (side === 'NGO' && h.ngo_received_quantity !== null) throw conflict('The NGO has already confirmed this handover.', 'ALREADY_CONFIRMED');
      const donorQty = side === 'DONOR' ? quantity : h.donor_confirmed_quantity;
      const ngoQty = side === 'NGO' ? quantity : h.ngo_received_quantity;
      if (side === 'DONOR') {
        await tx.query('UPDATE handover_records SET donor_confirmed_quantity = $2, donor_confirmed_by = $3, donor_confirmed_at = now(), notes = COALESCE($4, notes) WHERE id = $1', [h.id, quantity, auth.userId, notes ?? null]);
      } else {
        await tx.query('UPDATE handover_records SET ngo_received_quantity = $2, ngo_confirmed_by = $3, ngo_confirmed_at = now(), notes = COALESCE($4, notes) WHERE id = $1', [h.id, quantity, auth.userId, notes ?? null]);
      }
      await recordAudit(tx, actor, { action: `handover.${side.toLowerCase()}_confirmed`, entityType: 'handover', entityId: h.id, changes: { quantity } });

      if (donorQty === null || ngoQty === null) {
        await tx.query('UPDATE handover_records SET status = $2 WHERE id = $1', [h.id, donorQty === null ? 'PENDING_DONOR' : 'PENDING_NGO']);
        const other = side === 'DONOR' ? pre.rep_user_id : pre.donor_owner;
        notices.push(
          await this.notifications.create(tx, {
            userId: other,
            type: 'HANDOVER_AWAITING_CONFIRMATION',
            title: 'Confirm the handover',
            body: `${side === 'DONOR' ? pre.donor_name : pre.ngo_name} confirmed the handover. Please confirm the quantity ${side === 'DONOR' ? 'received' : 'handed over'}.`,
            linkPath: side === 'DONOR' ? `/ngo/pickups/${pickupId}` : `/donor/pickups/${pickupId}`,
            priority: 'HIGH',
            dedupeKey: `handover-awaiting:${h.id}:${side}`,
          }),
        );
        return;
      }

      if (donorQty === ngoQty && donorQty > 0) {
        outcome = 'CONFIRMED';
        await tx.query(`UPDATE handover_records SET status = 'CONFIRMED' WHERE id = $1`, [h.id]);
        assertTransition('allocation', pre.allocation_status, 'PICKED_UP');
        await tx.query(`UPDATE donation_allocations SET status = 'PICKED_UP', handed_over_quantity = $2 WHERE id = $1`, [pre.allocation_id, donorQty]);
        await tx.query(`UPDATE pickup_assignments SET status = 'HANDED_OVER', handed_over_at = now() WHERE id = $1`, [pickupId]);
        ended.push(...(await this.endTracking(tx, pickupId, 'handover confirmed', 'TO_PICKUP')));
        await this.allocations.rollupDonationStatus(tx, pre.donation_id, auth.userId, 'handover confirmed');
        const credit = await this.rewards.creditForHandover(tx, h.id, donorQty, actor);
        const fee = await this.billing.recordFeeForHandover(tx, h.id, donorQty, actor);
        await recordAudit(tx, actor, { action: 'handover.confirmed', entityType: 'handover', entityId: h.id, metadata: { quantity: donorQty, points: credit.points, fee: fee.totalAmount } });
        notices.push(credit.notice);
        notices.push(
          await this.notifications.create(tx, {
            userId: pre.ngo_owner,
            type: 'HANDOVER_CONFIRMED',
            title: 'Handover confirmed',
            body: `${donorQty} ${unitLabel(pre.unit, donorQty)} of ${pre.food_name} collected from ${pre.donor_name}. A service fee of INR ${fee.totalAmount.toFixed(2)} was recorded. Confirm delivery when the food reaches its destination.`,
            linkPath: `/ngo/pickups/${pickupId}`,
            dedupeKey: `handover-confirmed:${h.id}`,
          }),
        );
        return;
      }

      outcome = 'DISPUTED';
      const opened = await this.openHandoverDispute(tx, pre, h.id, actor, auth.userId, {
        raisedBy: null,
        description: `Donor confirmed ${donorQty}; NGO confirmed ${ngoQty} ${pre.unit.toLowerCase()}. Flagged automatically for review; no points or fees were recorded.`,
        title: 'Handover quantities do not match',
        partyBody: `The donor confirmed ${donorQty} and the NGO confirmed ${ngoQty}. FoodBridge will review the handover; no points or fees are recorded until it is resolved.`,
        adminBody: `Quantity mismatch for ${pre.food_name}: donor ${donorQty}, NGO ${ngoQty}.`,
        metadata: { donorQty, ngoQty },
      });
      notices.push(...opened.notices);
      ended.push(...opened.ended);
    });
    this.notifications.publish(notices);
    this.publishTrackingEnded(ended);
    return { outcome, pickup: await this.get(auth, pickupId) };
  }

  /**
   * Puts a handover under admin review: the handover, allocation and pickup become DISPUTED, the
   * collection leg of tracking ends, and both parties and the admins are notified. No points or
   * fees are recorded until an admin resolves it. Returns notifications and ended tracking sessions.
   */
  private async openHandoverDispute(
    tx: Queryable,
    pre: PickupRow,
    handoverId: string,
    actor: Actor,
    byUserId: string,
    info: { raisedBy: string | null; description: string; title: string; partyBody: string; adminBody: string; metadata: Record<string, unknown> },
  ): Promise<{ notices: (NotificationRow | null)[]; ended: string[] }> {
    await tx.query(`UPDATE handover_records SET status = 'DISPUTED' WHERE id = $1`, [handoverId]);
    await tx.query(`UPDATE donation_allocations SET status = 'DISPUTED' WHERE id = $1`, [pre.allocation_id]);
    await tx.query(`UPDATE pickup_assignments SET status = 'DISPUTED' WHERE id = $1`, [pre.id]);
    const ended = await this.endTracking(tx, pre.id, 'handover disputed', 'TO_PICKUP');
    const dispute = await one<{ id: string }>(
      tx,
      `INSERT INTO disputes (allocation_id, pickup_assignment_id, handover_record_id, raised_by, type, description)
       VALUES ($1, $2, $3, $4, 'QUANTITY_MISMATCH', $5) RETURNING id`,
      [pre.allocation_id, pre.id, handoverId, info.raisedBy, info.description],
    );
    await this.allocations.rollupDonationStatus(tx, pre.donation_id, byUserId, 'handover disputed');
    await recordAudit(tx, actor, { action: 'handover.disputed', entityType: 'handover', entityId: handoverId, metadata: { ...info.metadata, disputeId: dispute?.id } });
    const notices: (NotificationRow | null)[] = [];
    for (const userId of [pre.donor_owner, pre.ngo_owner]) {
      notices.push(
        await this.notifications.create(tx, {
          userId,
          type: 'HANDOVER_DISPUTED',
          title: info.title,
          body: info.partyBody,
          linkPath: userId === pre.donor_owner ? `/donor/pickups/${pre.id}` : `/ngo/pickups/${pre.id}`,
          priority: 'HIGH',
          dedupeKey: `handover-disputed:${handoverId}:${userId}`,
        }),
      );
    }
    notices.push(
      ...(await this.notifications.notifyAdmins(tx, {
        type: 'DISPUTE_OPENED',
        title: 'Handover dispute needs review',
        body: info.adminBody,
        linkPath: '/admin/disputes',
        priority: 'HIGH',
        dedupeKey: `dispute:${dispute?.id}`,
      })),
    );
    return { notices, ended };
  }

  /** No-show or failed collection: the pickup fails and the reservation returns to RESERVED so it can be reassigned. */
  async reportFailure(auth: AuthContext, pickupId: string, reason: string, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    const ended: string[] = [];
    await this.db.transaction(async (tx) => {
      const pre = await this.find(tx, pickupId);
      if (!pre) throw notFound('Pickup');
      const viewer = this.viewer(auth, pre);
      if (viewer === 'ADMIN') throw forbidden();
      await tx.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [pre.donation_id]);
      const p = await one<{ status: string }>(tx, 'SELECT status FROM pickup_assignments WHERE id = $1 FOR UPDATE', [pickupId]);
      assertTransition('pickup', p?.status ?? '', 'FAILED');
      // If one side has already confirmed a handed-over quantity, the other side cannot simply void it:
      // the disagreement goes to an admin as a dispute (no points or fees until it is resolved).
      const h = await one<{ id: string; donor_confirmed_quantity: number | null; ngo_received_quantity: number | null }>(
        tx,
        'SELECT id, donor_confirmed_quantity, ngo_received_quantity FROM handover_records WHERE pickup_assignment_id = $1 FOR UPDATE',
        [pickupId],
      );
      if (h && (h.donor_confirmed_quantity !== null || h.ngo_received_quantity !== null)) {
        await tx.query('SELECT 1 FROM donation_allocations WHERE id = $1 FOR UPDATE', [pre.allocation_id]);
        const reporter = viewer === 'DONOR' ? 'The donor' : 'The NGO';
        const confirmed = h.donor_confirmed_quantity !== null ? `the donor confirmed ${h.donor_confirmed_quantity}` : `the NGO confirmed ${h.ngo_received_quantity}`;
        const opened = await this.openHandoverDispute(tx, pre, h.id, actor, auth.userId, {
          raisedBy: auth.userId,
          description: `${reporter} reported the pickup as failed after ${confirmed} ${pre.unit.toLowerCase()}: ${reason}`.slice(0, 2000),
          title: 'Handover needs review',
          partyBody: `${reporter} reported this pickup as failed after ${confirmed}. FoodBridge will review the handover; no points or fees are recorded until it is resolved.`,
          adminBody: `${reporter} reported a failed pickup of ${pre.food_name} after ${confirmed}: ${reason}`.slice(0, 500),
          metadata: { reportedFailure: true, reason, donorQty: h.donor_confirmed_quantity, ngoQty: h.ngo_received_quantity },
        });
        notices.push(...opened.notices);
        ended.push(...opened.ended);
        return;
      }
      await tx.query(`UPDATE pickup_assignments SET status = 'FAILED', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`, [pickupId, reason]);
      await tx.query('UPDATE pickup_tokens SET revoked_at = now() WHERE pickup_assignment_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL', [pickupId]);
      ended.push(...(await this.endTracking(tx, pickupId, 'pickup failed')));
      await tx.query(`UPDATE donation_allocations SET status = 'RESERVED' WHERE id = $1 AND status = 'PICKUP_ASSIGNED'`, [pre.allocation_id]);
      if (pre.assistance_offer_id) await tx.query(`UPDATE assistance_offers SET status = 'RESERVED' WHERE id = $1 AND status = 'PICKUP_ASSIGNED'`, [pre.assistance_offer_id]);
      if (viewer === 'DONOR') {
        await tx.query(`INSERT INTO disputes (allocation_id, pickup_assignment_id, raised_by, type, description) VALUES ($1, $2, $3, 'NO_SHOW', $4)`, [pre.allocation_id, pickupId, auth.userId, reason]);
      }
      await this.allocations.rollupDonationStatus(tx, pre.donation_id, auth.userId, 'pickup failed');
      await recordAudit(tx, actor, { action: 'pickup.failed', entityType: 'pickup', entityId: pickupId, changes: { reason, reportedBy: viewer } });
      notices.push(
        await this.notifications.create(tx, {
          userId: viewer === 'DONOR' ? pre.ngo_owner : pre.donor_owner,
          type: 'PICKUP_FAILED',
          title: 'Pickup did not happen',
          body: `The pickup of ${pre.food_name} was reported as failed: ${reason}. The reservation is kept so a new pickup can be assigned before the deadline.`,
          linkPath: viewer === 'DONOR' ? '/ngo/collections' : `/donor/donations/${pre.donation_id}`,
          priority: 'HIGH',
          dedupeKey: `pickup-failed:${pickupId}`,
        }),
      );
    });
    this.notifications.publish(notices);
    this.publishTrackingEnded(ended);
    return this.get(auth, pickupId);
  }

  /** NGO confirms the food reached its destination. Completes the allocation (and the offer, if any). */
  async confirmDelivery(auth: AuthContext, pickupId: string, input: { deliveredQuantity: number; beneficiariesServed?: number | undefined; notes?: string | undefined; location?: LatLng | undefined }, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    const ended: string[] = [];
    await this.db.transaction(async (tx) => {
      const pre = await this.find(tx, pickupId);
      if (!pre) throw notFound('Pickup');
      const viewer = this.viewer(auth, pre);
      if (viewer !== 'REPRESENTATIVE' && viewer !== 'NGO_OWNER') throw forbidden('Only the NGO can confirm delivery.');
      await tx.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [pre.donation_id]);
      const a = await one<{ status: string; handed_over_quantity: number | null }>(tx, 'SELECT status, handed_over_quantity FROM donation_allocations WHERE id = $1 FOR UPDATE', [pre.allocation_id]);
      const p = await one<{ status: string }>(tx, 'SELECT status FROM pickup_assignments WHERE id = $1 FOR UPDATE', [pickupId]);
      if (!p || !['HANDED_OVER', 'IN_TRANSIT'].includes(p.status)) throw conflict('Delivery can be confirmed only after a confirmed handover.', 'DELIVERY_NOT_ALLOWED');
      if (input.deliveredQuantity > (a?.handed_over_quantity ?? 0)) throw unprocessable('Delivered quantity cannot exceed the quantity handed over.', 'DELIVERY_EXCEEDS_HANDOVER');
      await tx.query(
        `INSERT INTO delivery_confirmations (pickup_assignment_id, delivered_quantity, confirmed_by, destination_location, beneficiaries_served, distribution_notes)
         VALUES ($1, $2, $3, CASE WHEN $4::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography END, $6, $7)`,
        [pickupId, input.deliveredQuantity, auth.userId, input.location?.lat ?? null, input.location?.lng ?? null, input.beneficiariesServed ?? null, input.notes ?? null],
      );
      await tx.query(`UPDATE pickup_assignments SET status = 'DELIVERED', delivered_at = now() WHERE id = $1`, [pickupId]);
      assertTransition('allocation', a?.status ?? '', 'COMPLETED');
      await tx.query(`UPDATE donation_allocations SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [pre.allocation_id]);
      if (pre.assistance_offer_id) {
        await tx.query(`UPDATE assistance_offers SET status = 'COMPLETED' WHERE id = $1`, [pre.assistance_offer_id]);
        await tx.query(
          `UPDATE food_assistance_requests SET quantity_received = quantity_received + $2 WHERE id = (SELECT assistance_request_id FROM assistance_offers WHERE id = $1)`,
          [pre.assistance_offer_id, input.deliveredQuantity],
        );
      }
      ended.push(...(await this.endTracking(tx, pickupId, 'delivered')));
      await this.allocations.rollupDonationStatus(tx, pre.donation_id, auth.userId, 'delivery confirmed');
      await recordAudit(tx, actor, { action: 'pickup.delivered', entityType: 'pickup', entityId: pickupId, changes: { ...input } });
      notices.push(
        await this.notifications.create(tx, {
          userId: pre.donor_owner,
          type: 'DELIVERY_CONFIRMED',
          title: 'Your food reached people in need',
          body: `${pre.ngo_name} confirmed delivery of ${input.deliveredQuantity} ${unitLabel(pre.unit, input.deliveredQuantity)} of ${pre.food_name}${input.beneficiariesServed ? ` to ${input.beneficiariesServed} beneficiaries` : ''}.`,
          linkPath: `/donor/donations/${pre.donation_id}`,
          dedupeKey: `delivered:${pickupId}`,
        }),
      );
    });
    this.notifications.publish(notices);
    this.publishTrackingEnded(ended);
    return this.get(auth, pickupId);
  }

  // -------------------------------------------------------------------------
  // Disputes
  // -------------------------------------------------------------------------
  async disputes(auth: AuthContext, status?: string) {
    const where: string[] = [];
    const v: unknown[] = [];
    if (auth.role === 'DONOR') where.push(`d.donor_id = $${v.push(auth.donorId)}`);
    else if (auth.role === 'NGO') where.push(`a.ngo_id = $${v.push(scopedNgoId(auth))}`);
    if (status) where.push(`x.status = $${v.push(status)}`);
    return many(
      this.db,
      `SELECT x.id, x.type, x.status, x.description, x.resolution, x.resolved_quantity AS "resolvedQuantity", x.created_at AS "createdAt", x.resolved_at AS "resolvedAt",
              x.allocation_id AS "allocationId", x.pickup_assignment_id AS "pickupId", d.food_name AS "foodName", d.unit, dn.business_name AS "donorName",
              n.organization_name AS "ngoName", hr.donor_confirmed_quantity AS "donorQuantity", hr.ngo_received_quantity AS "ngoQuantity", a.quantity AS "allocatedQuantity"
         FROM disputes x JOIN donation_allocations a ON a.id = x.allocation_id JOIN donations d ON d.id = a.donation_id JOIN donors dn ON dn.id = d.donor_id
         JOIN ngos n ON n.id = a.ngo_id LEFT JOIN handover_records hr ON hr.id = x.handover_record_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY x.created_at DESC LIMIT 200`,
      v,
    );
  }

  /**
   * Admin resolution. CONFIRM_QUANTITY confirms the handover at an agreed
   * quantity (then, and only then, points and the fee are recorded with that
   * quantity). CANCEL_COLLECTION cancels it with no points and no fee.
   */
  async resolveDispute(disputeId: string, input: { outcome: 'CONFIRM_QUANTITY' | 'CANCEL_COLLECTION'; resolvedQuantity?: number | undefined; resolution: string }, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    const ended: string[] = [];
    await this.db.transaction(async (tx) => {
      const x = await one<{ id: string; status: string; type: string; allocation_id: string; handover_record_id: string | null; pickup_assignment_id: string | null }>(
        tx,
        'SELECT id, status, type, allocation_id, handover_record_id, pickup_assignment_id FROM disputes WHERE id = $1',
        [disputeId],
      );
      if (!x) throw notFound('Dispute');
      if (!['OPEN', 'UNDER_REVIEW'].includes(x.status)) throw conflict('This dispute is already closed.', 'DISPUTE_CLOSED');
      const a = await one<{ donation_id: string; quantity: number; status: string; ngo_id: string }>(tx, 'SELECT donation_id, quantity, status, ngo_id FROM donation_allocations WHERE id = $1', [x.allocation_id]);
      if (!a) throw notFound('Allocation');
      await tx.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [a.donation_id]);
      const allocation = await one<{ status: string }>(tx, 'SELECT status FROM donation_allocations WHERE id = $1 FOR UPDATE', [x.allocation_id]);
      // Re-check under lock (same order as every other writer: donation, allocation, then dispute), so two
      // concurrent resolutions cannot both apply.
      const current = await one<{ status: string }>(tx, 'SELECT status FROM disputes WHERE id = $1 FOR UPDATE', [disputeId]);
      if (!current || !['OPEN', 'UNDER_REVIEW'].includes(current.status)) throw conflict('This dispute is already closed.', 'DISPUTE_CLOSED');
      if (x.type === 'QUANTITY_MISMATCH' && x.handover_record_id) {
        if (allocation?.status !== 'DISPUTED') throw conflict('This collection is no longer under dispute.', 'ALLOCATION_NOT_DISPUTED');
        if (input.outcome === 'CONFIRM_QUANTITY') {
          const q = input.resolvedQuantity;
          if (!q || q <= 0 || q > a.quantity) throw unprocessable(`Resolved quantity must be between 1 and ${a.quantity}.`, 'INVALID_RESOLVED_QUANTITY');
          await tx.query(`UPDATE handover_records SET donor_confirmed_quantity = $2, ngo_received_quantity = $2, status = 'CONFIRMED', notes = coalesce(notes, '') || $3 WHERE id = $1`, [
            x.handover_record_id,
            q,
            ` [Admin-resolved dispute ${disputeId}]`,
          ]);
          await tx.query(`UPDATE donation_allocations SET status = 'PICKED_UP', handed_over_quantity = $2 WHERE id = $1`, [x.allocation_id, q]);
          if (x.pickup_assignment_id) await tx.query(`UPDATE pickup_assignments SET status = 'HANDED_OVER', handed_over_at = COALESCE(handed_over_at, now()) WHERE id = $1`, [x.pickup_assignment_id]);
          const credit = await this.rewards.creditForHandover(tx, x.handover_record_id, q, actor);
          await this.billing.recordFeeForHandover(tx, x.handover_record_id, q, actor);
          notices.push(credit.notice);
        } else {
          // Full unwind: releases the quantity, cancels the pickup (revoking passes, ending tracking)
          // and reverses the source donation request or assistance offer commitment.
          notices.push(
            ...(await this.allocations.releaseAllocation(tx, x.allocation_id, { status: 'CANCELLED', party: 'ADMIN', reason: `dispute resolved: ${input.resolution}`, fromDispute: true }, actor)),
          );
        }
        await this.allocations.rollupDonationStatus(tx, a.donation_id, actor.userId, 'dispute resolved');
      }
      await tx.query(
        `UPDATE disputes SET status = $2, resolution = $3, resolved_quantity = $4, resolved_by = $5, resolved_at = now() WHERE id = $1`,
        [disputeId, input.outcome === 'CANCEL_COLLECTION' ? 'REJECTED' : 'RESOLVED', input.resolution, input.resolvedQuantity ?? null, actor.userId],
      );
      await recordAudit(tx, actor, { action: 'dispute.resolved', entityType: 'dispute', entityId: disputeId, changes: { ...input } });
      const parties = await this.allocations.parties(tx, x.allocation_id);
      for (const userId of [parties.donorUserId, parties.ngoUserId]) {
        const isDonor = userId === parties.donorUserId;
        // Link each party to the collection the dispute was about (or, without a pickup, to their list).
        const linkPath = x.pickup_assignment_id
          ? `/${isDonor ? 'donor' : 'ngo'}/pickups/${x.pickup_assignment_id}`
          : isDonor
            ? `/donor/donations/${a.donation_id}`
            : '/ngo/collections';
        notices.push(
          await this.notifications.create(tx, {
            userId,
            type: 'DISPUTE_RESOLVED',
            title: 'Dispute resolved',
            body: `The handover dispute for ${parties.foodName} was resolved: ${input.resolution}`,
            linkPath,
            dedupeKey: `dispute-resolved:${disputeId}:${userId}`,
          }),
        );
      }
    });
    this.notifications.publish(notices);
    this.publishTrackingEnded(ended);
  }

  /** QR pass and identity-check attempt log for admins. */
  async verificationLog(limit = 200) {
    return many(
      this.db,
      `SELECT v.id, v.pickup_assignment_id AS "pickupId", v.method, v.result, v.failure_reason AS "failureReason", u.email AS "actorEmail",
              host(v.ip) AS ip, v.created_at AS "createdAt"
         FROM pickup_verifications v LEFT JOIN users u ON u.id = v.actor_user_id ORDER BY v.id DESC LIMIT $1`,
      [limit],
    );
  }
}
