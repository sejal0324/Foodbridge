import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { assertTransition, donationStatusFromQuantities, requestStatusFromQuantities } from '../domain/state-machines.js';
import { insertDonationHistory } from '../repositories/donation.repository.js';
import { type Actor, type AuthContext, scopedNgoId } from '../types/auth.js';
import { conflict, notFound } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';

export type Party = 'DONOR' | 'NGO' | 'ADMIN' | 'SYSTEM';

interface LockedDonation {
  id: string;
  status: string;
  quantity: number;
  reserved_quantity: number;
  pickup_deadline: Date;
  origin: string;
}

export interface AllocationRow {
  id: string;
  donation_id: string;
  ngo_id: string;
  quantity: number;
  source: 'DONATION_REQUEST' | 'ASSISTANCE_OFFER';
  donation_request_id: string | null;
  assistance_offer_id: string | null;
  status: string;
  handed_over_quantity: number | null;
}

const STAGE_ORDER = ['RESERVED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED'] as const;
const ACTIVE_ALLOCATION = `status NOT IN ('CANCELLED', 'EXPIRED')`;

/**
 * Quantity accounting shared by both discovery workflows. All methods take the
 * caller's transaction and lock rows in the documented order
 * (assistance request → offer → donation → donation request → allocation → pickup).
 */
export class AllocationService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Reserves `qty` from a listed donation. The row is locked first, so
   * concurrent reservations on the same donation are serialised; the CHECK
   * constraint `reserved_quantity <= quantity` is the final backstop.
   */
  async reserveDonationQuantity(tx: Queryable, donationId: string, qty: number, minLeadMinutes: number, actorUserId: string | null): Promise<void> {
    const d = await one<LockedDonation>(
      tx,
      `SELECT id, status, quantity, reserved_quantity, pickup_deadline, origin FROM donations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [donationId],
    );
    if (!d) throw notFound('Donation');
    if (!['AVAILABLE', 'PARTIALLY_RESERVED'].includes(d.status)) {
      throw conflict('This donation is no longer available for reservation.', 'DONATION_NOT_AVAILABLE', { status: d.status });
    }
    if (d.pickup_deadline.getTime() - Date.now() < minLeadMinutes * 60_000) {
      throw conflict('The pickup deadline is too close to reserve this donation.', 'PICKUP_DEADLINE_TOO_CLOSE');
    }
    const available = d.quantity - d.reserved_quantity;
    if (qty > available) {
      throw conflict(`Only ${available} ${available === 1 ? 'unit is' : 'units are'} still available.`, 'INSUFFICIENT_QUANTITY', { available, requested: qty });
    }
    const reserved = d.reserved_quantity + qty;
    const status = donationStatusFromQuantities(d.quantity, reserved);
    await tx.query('UPDATE donations SET reserved_quantity = $2, status = $3, version = version + 1 WHERE id = $1', [donationId, reserved, status]);
    if (status !== d.status) await insertDonationHistory(tx, donationId, d.status, status, actorUserId, 'quantity reserved', { quantity: qty });
  }

  async createAllocation(
    tx: Queryable,
    a: { donationId: string; ngoId: string; quantity: number; source: AllocationRow['source']; donationRequestId?: string; assistanceOfferId?: string },
  ): Promise<string> {
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO donation_allocations (donation_id, ngo_id, quantity, source, donation_request_id, assistance_offer_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [a.donationId, a.ngoId, a.quantity, a.source, a.donationRequestId ?? null, a.assistanceOfferId ?? null],
    );
    if (!row) throw new Error('allocation insert failed');
    return row.id;
  }

  /**
   * Recomputes a donation's status after an allocation changed. While unreserved
   * quantity can still be reserved, the donation stays AVAILABLE/PARTIALLY_RESERVED
   * so other NGOs can request it; once fully reserved (or past its deadline) it
   * follows the least-advanced active allocation.
   */
  async rollupDonationStatus(tx: Queryable, donationId: string, actorUserId: string | null, reason: string): Promise<string> {
    const d = await one<LockedDonation & { expired_quantity: number }>(
      tx,
      `SELECT id, status, quantity, reserved_quantity, expired_quantity, pickup_deadline, origin FROM donations WHERE id = $1 FOR UPDATE`,
      [donationId],
    );
    if (!d) throw notFound('Donation');
    if (['DRAFT', 'CANCELLED', 'EXPIRED', 'COMPLETED'].includes(d.status)) return d.status;
    const allocations = await many<{ status: string }>(tx, `SELECT status FROM donation_allocations WHERE donation_id = $1 AND ${ACTIVE_ALLOCATION}`, [donationId]);
    const deadlinePassed = d.pickup_deadline <= new Date();
    const openForReservation = !deadlinePassed && d.reserved_quantity < d.quantity && d.origin === 'DIRECT_LISTING';
    let next: string;
    if (allocations.some((a) => a.status === 'DISPUTED')) next = 'DISPUTED';
    else if (allocations.length === 0) next = deadlinePassed || d.origin === 'ASSISTANCE_OFFER' ? (deadlinePassed ? 'EXPIRED' : 'CANCELLED') : 'AVAILABLE';
    else if (openForReservation) next = donationStatusFromQuantities(d.quantity, d.reserved_quantity);
    else {
      const minStage = Math.min(...allocations.map((a) => STAGE_ORDER.indexOf(a.status as (typeof STAGE_ORDER)[number])));
      next = STAGE_ORDER[Math.max(0, minStage)] ?? 'RESERVED';
      if (next === 'RESERVED' && d.reserved_quantity < d.quantity && !deadlinePassed) next = 'PARTIALLY_RESERVED';
    }
    if (next !== d.status) {
      await tx.query('UPDATE donations SET status = $2, version = version + 1 WHERE id = $1', [donationId, next]);
      await insertDonationHistory(tx, donationId, d.status, next, actorUserId, reason);
    }
    return next;
  }

  /**
   * Cancels or expires an allocation that has not been picked up: releases its
   * quantity, ends any active pickup (revoking QR passes) and unwinds
   * the source request or offer. Returns notifications to publish after commit.
   */
  async releaseAllocation(
    tx: Queryable,
    allocationId: string,
    opts: { status: 'CANCELLED' | 'EXPIRED'; party: Party; reason: string; fromDispute?: boolean },
    actor: Actor,
  ): Promise<(NotificationRow | null)[]> {
    // Lock order: donation before allocation (see class docs).
    const pre = await one<{ donation_id: string }>(tx, 'SELECT donation_id FROM donation_allocations WHERE id = $1', [allocationId]);
    if (!pre) throw notFound('Allocation');
    await tx.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [pre.donation_id]);
    const a = await one<AllocationRow>(tx, 'SELECT * FROM donation_allocations WHERE id = $1 FOR UPDATE', [allocationId]);
    if (!a) throw notFound('Allocation');
    assertTransition('allocation', a.status, opts.status);
    // An admin resolving a handover dispute by cancelling the collection may release a DISPUTED allocation.
    const releasable = opts.fromDispute ? ['DISPUTED'] : ['RESERVED', 'PICKUP_ASSIGNED'];
    if (!releasable.includes(a.status)) {
      throw conflict('Only allocations that have not been picked up can be released.', 'ALLOCATION_NOT_RELEASABLE');
    }
    if (opts.party === 'DONOR' || opts.party === 'NGO') {
      // Once the representative is verified at the donor, a handover is under way (and may be confirmed by one
      // side). Neither side may void it unilaterally: they confirm the real quantity or report the pickup as failed.
      const verified = await one(tx, `SELECT 1 FROM pickup_assignments WHERE allocation_id = $1 AND status = 'VERIFIED'`, [allocationId]);
      if (verified) {
        throw conflict(
          'The representative has already been verified for this collection. Confirm the handover, or report the pickup as failed, instead of cancelling.',
          'HANDOVER_IN_PROGRESS',
        );
      }
    }
    await tx.query(
      `UPDATE donation_allocations SET status = $2, cancelled_at = now(), cancel_reason = $3, cancelled_by_party = $4 WHERE id = $1`,
      [allocationId, opts.status, opts.reason.slice(0, 500), opts.party],
    );
    // End any active pickup and invalidate its credentials.
    const pickups = await many<{ id: string }>(
      tx,
      `UPDATE pickup_assignments SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2
        WHERE allocation_id = $1 AND status IN ('ASSIGNED', 'EN_ROUTE', 'VERIFIED', 'DISPUTED') RETURNING id`,
      [allocationId, `allocation ${opts.status.toLowerCase()}: ${opts.reason}`.slice(0, 500)],
    );
    for (const p of pickups) {
      await tx.query('UPDATE pickup_tokens SET revoked_at = now() WHERE pickup_assignment_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL', [p.id]);
      await tx.query(`UPDATE tracking_sessions SET status = 'ENDED', ended_at = now(), end_reason = 'pickup cancelled' WHERE pickup_assignment_id = $1 AND status = 'ACTIVE'`, [p.id]);
    }
    // Release reserved quantity (donation row already locked above).
    await tx.query('UPDATE donations SET reserved_quantity = reserved_quantity - $2, version = version + 1 WHERE id = $1', [a.donation_id, a.quantity]);

    if (a.source === 'DONATION_REQUEST' && a.donation_request_id) {
      await tx.query(`UPDATE donation_requests SET status = 'CANCELLED', decision_reason = $2 WHERE id = $1 AND status = 'APPROVED'`, [
        a.donation_request_id,
        opts.reason.slice(0, 500),
      ]);
    }
    if (a.source === 'ASSISTANCE_OFFER' && a.assistance_offer_id) {
      await this.unwindOffer(tx, a.assistance_offer_id, opts.status, opts.reason, actor);
    }
    await this.rollupDonationStatus(tx, a.donation_id, actor.userId, `allocation ${opts.status.toLowerCase()}`);
    await recordAudit(tx, actor, {
      action: `allocation.${opts.status.toLowerCase()}`,
      entityType: 'allocation',
      entityId: allocationId,
      changes: { from: a.status, to: opts.status, party: opts.party, reason: opts.reason, quantityReleased: a.quantity },
    });

    const parties = await this.parties(tx, allocationId);
    const label = opts.status === 'EXPIRED' ? 'expired' : 'was cancelled';
    const body = `The reservation of ${a.quantity} ${parties.unit.toLowerCase()} of ${parties.foodName} ${label}${opts.reason ? `: ${opts.reason}` : '.'}`;
    const notify = (userId: string, link: string) =>
      this.notifications.create(tx, {
        userId,
        type: opts.status === 'EXPIRED' ? 'ALLOCATION_EXPIRED' : 'ALLOCATION_CANCELLED',
        title: `Reservation ${label}`,
        body,
        linkPath: link,
        priority: 'HIGH',
        dedupeKey: `allocation-${opts.status.toLowerCase()}:${allocationId}`,
        email: true,
      });
    const out: (NotificationRow | null)[] = [];
    if (opts.party !== 'DONOR') out.push(await notify(parties.donorUserId, `/donor/donations/${a.donation_id}`));
    if (opts.party !== 'NGO') out.push(await notify(parties.ngoUserId, `/ngo/collections`));
    return out;
  }

  /** Reverses an offer's commitment against its assistance request. */
  private async unwindOffer(tx: Queryable, offerId: string, status: 'CANCELLED' | 'EXPIRED', reason: string, actor: Actor): Promise<void> {
    const offer = await one<{ assistance_request_id: string; status: string; accepted_quantity: number | null; confirmed_quantity: number | null }>(
      tx,
      'SELECT assistance_request_id, status, accepted_quantity, confirmed_quantity FROM assistance_offers WHERE id = $1',
      [offerId],
    );
    if (!offer || ['CANCELLED', 'EXPIRED', 'REJECTED', 'COMPLETED'].includes(offer.status)) return;
    const committed = offer.confirmed_quantity ?? offer.accepted_quantity ?? 0;
    await tx.query('UPDATE assistance_offers SET status = $2, cancel_reason = $3, cancelled_by = $4 WHERE id = $1', [offerId, status, reason.slice(0, 500), actor.userId]);
    await this.adjustRequestCommitment(tx, offer.assistance_request_id, -committed, actor, offerId, `OFFER_${status}`);
  }

  /** Changes committed quantity on an assistance request and recomputes its status (request must already be locked or lockable). */
  async adjustRequestCommitment(tx: Queryable, requestId: string, delta: number, actor: Actor, offerId: string | null, eventType: string): Promise<void> {
    const r = await one<{ status: string; quantity_required: number; quantity_committed: number; needed_until: Date }>(
      tx,
      'SELECT status, quantity_required, quantity_committed, needed_until FROM food_assistance_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    );
    if (!r) throw notFound('Assistance request');
    const committed = Math.max(0, r.quantity_committed + delta);
    let status = r.status;
    if (['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED'].includes(r.status)) {
      status = r.needed_until <= new Date() && committed < r.quantity_required ? 'EXPIRED' : requestStatusFromQuantities(r.quantity_required, committed);
    }
    await tx.query('UPDATE food_assistance_requests SET quantity_committed = $2, status = $3, version = version + 1 WHERE id = $1', [requestId, committed, status]);
    await tx.query(
      `INSERT INTO assistance_request_history (assistance_request_id, assistance_offer_id, event_type, from_status, to_status, quantity_delta, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [requestId, offerId, eventType, r.status, status, delta, actor.userId],
    );
  }

  /** Users and labels involved in an allocation (for notifications and authorisation). */
  async parties(q: Queryable, allocationId: string) {
    const row = await one<{
      donor_user_id: string;
      donor_id: string;
      donor_name: string;
      ngo_user_id: string;
      ngo_id: string;
      ngo_name: string;
      food_name: string;
      unit: string;
    }>(
      q,
      `SELECT dn.owner_user_id AS donor_user_id, dn.id AS donor_id, dn.business_name AS donor_name,
              n.owner_user_id AS ngo_user_id, n.id AS ngo_id, n.organization_name AS ngo_name, d.food_name, d.unit
         FROM donation_allocations a JOIN donations d ON d.id = a.donation_id JOIN donors dn ON dn.id = d.donor_id JOIN ngos n ON n.id = a.ngo_id
        WHERE a.id = $1`,
      [allocationId],
    );
    if (!row) throw notFound('Allocation');
    return {
      donorUserId: row.donor_user_id,
      donorId: row.donor_id,
      donorName: row.donor_name,
      ngoUserId: row.ngo_user_id,
      ngoId: row.ngo_id,
      ngoName: row.ngo_name,
      foodName: row.food_name,
      unit: row.unit,
    };
  }

  // -------------------------------------------------------------------------
  // HTTP-facing operations
  // -------------------------------------------------------------------------

  async list(auth: AuthContext, filter: { status?: string | undefined; page: number; pageSize: number }) {
    const where: string[] = [];
    const v: unknown[] = [];
    if (auth.role === 'DONOR') where.push(`d.donor_id = $${v.push(auth.donorId)}`);
    else if (auth.role === 'NGO') where.push(`a.ngo_id = $${v.push(scopedNgoId(auth))}`);
    if (filter.status) where.push(`a.status = $${v.push(filter.status)}`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT a.id, a.donation_id, a.ngo_id, n.organization_name AS ngo_name, d.donor_id, dn.business_name AS donor_name, a.quantity,
              a.source, a.status, a.handed_over_quantity, a.created_at, a.completed_at, a.cancelled_at, a.cancel_reason,
              d.food_name, d.unit, d.dietary_type, d.pickup_deadline, d.address,
              (SELECT p.id FROM pickup_assignments p WHERE p.allocation_id = a.id AND p.status NOT IN ('CANCELLED','FAILED') ORDER BY p.created_at DESC LIMIT 1) AS pickup_id,
              (SELECT p.status FROM pickup_assignments p WHERE p.allocation_id = a.id AND p.status NOT IN ('CANCELLED','FAILED') ORDER BY p.created_at DESC LIMIT 1) AS pickup_status
         FROM donation_allocations a JOIN donations d ON d.id = a.donation_id JOIN donors dn ON dn.id = d.donor_id JOIN ngos n ON n.id = a.ngo_id
         ${w} ORDER BY a.created_at DESC LIMIT $${v.length + 1} OFFSET $${v.length + 2}`,
      [...v, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    const total = await one<{ n: number }>(
      this.db,
      `SELECT count(*) AS n FROM donation_allocations a JOIN donations d ON d.id = a.donation_id ${w}`,
      v,
    );
    return { items: rows.map(toAllocationDto), total: total?.n ?? 0 };
  }

  async cancel(auth: AuthContext, allocationId: string, reason: string, actor: Actor): Promise<void> {
    const parties = await this.parties(this.db, allocationId);
    const party: Party | null =
      auth.role === 'ADMIN' ? 'ADMIN' : auth.role === 'DONOR' && auth.donorId === parties.donorId ? 'DONOR' : auth.role === 'NGO' && auth.ngoId === parties.ngoId ? 'NGO' : null;
    if (!party) throw notFound('Allocation');
    const notices = await this.db.transaction((tx) => this.releaseAllocation(tx, allocationId, { status: 'CANCELLED', party, reason }, actor));
    this.notifications.publish(notices);
  }
}

export function toAllocationDto(r: Record<string, unknown>) {
  return {
    id: r.id,
    donationId: r.donation_id,
    ngo: { id: r.ngo_id, name: r.ngo_name },
    donor: { id: r.donor_id, name: r.donor_name },
    foodName: r.food_name,
    unit: r.unit,
    dietaryType: r.dietary_type,
    quantity: r.quantity,
    source: r.source,
    status: r.status,
    handedOverQuantity: r.handed_over_quantity,
    pickupDeadline: r.pickup_deadline,
    address: r.address,
    pickup: r.pickup_id ? { id: r.pickup_id, status: r.pickup_status } : null,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

