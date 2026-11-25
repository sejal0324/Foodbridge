import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { assertTransition, requestStatusFromQuantities } from '../domain/state-machines.js';
import { enqueueJob } from '../jobs/queue.js';
import { insertDonation, insertDonationHistory } from '../repositories/donation.repository.js';
import { findDonorById, findNgoById, latLngColumns } from '../repositories/organisation.repository.js';
import { type Actor, type AuthContext, scopedNgoId } from '../types/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { formatDateTime, formatTime, unitLabel } from '../utils/format.js';
import type { LatLng } from '../validators/common.js';
import type { AllocationService } from './allocation.service.js';
import { recordAudit } from './audit.service.js';
import type { FeeService } from './fee.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';

export const MATCH_REQUEST_JOB = 'match-assistance-request';

/** Address text when none is given: the organisation's street/city, or its name at the registered location. */
export function fallbackAddress(orgName: string, addressLine: string | null, city: string | null): string {
  const parts = [addressLine, city].filter(Boolean).join(', ');
  return parts.length >= 5 ? parts : `${orgName}${city ? `, ${city}` : ''} (registered location)`.slice(0, 300);
}

interface RequestRow {
  id: string;
  ngo_id: string;
  ngo_name: string;
  ngo_owner: string;
  category_id: string;
  category_code: string;
  category_name: string;
  dietary_requirement: 'VEG_ONLY' | 'ANY';
  quantity_required: number;
  unit: string;
  quantity_committed: number;
  quantity_received: number;
  needed_from: Date;
  needed_until: Date;
  lat: number;
  lng: number;
  address: string;
  urgency: string;
  beneficiaries_count: number;
  reason: string | null;
  additional_requirements: string | null;
  status: string;
  version: number;
  created_at: Date;
  distance_m?: number | null;
}

const REQUEST_SELECT = `
  SELECT f.id, f.ngo_id, n.organization_name AS ngo_name, n.owner_user_id AS ngo_owner, f.category_id, c.code AS category_code,
         c.name AS category_name, f.dietary_requirement, f.quantity_required, f.unit, f.quantity_committed, f.quantity_received,
         f.needed_from, f.needed_until, ${latLngColumns('f.location')}, f.address, f.urgency, f.beneficiaries_count, f.reason,
         f.additional_requirements, f.status, f.version, f.created_at
    FROM food_assistance_requests f JOIN ngos n ON n.id = f.ngo_id JOIN food_categories c ON c.id = f.category_id`;

function toRequestDto(r: RequestRow) {
  return {
    id: r.id,
    ngo: { id: r.ngo_id, name: r.ngo_name },
    category: { id: r.category_id, code: r.category_code, name: r.category_name },
    dietaryRequirement: r.dietary_requirement,
    quantityRequired: r.quantity_required,
    quantityCommitted: r.quantity_committed,
    quantityRemaining: Math.max(0, r.quantity_required - r.quantity_committed),
    quantityReceived: r.quantity_received,
    unit: r.unit,
    neededFrom: r.needed_from,
    neededUntil: r.needed_until,
    location: { lat: r.lat, lng: r.lng },
    address: r.address,
    urgency: r.urgency,
    beneficiariesCount: r.beneficiaries_count,
    reason: r.reason,
    additionalRequirements: r.additional_requirements,
    status: r.status,
    version: r.version,
    createdAt: r.created_at,
    ...(r.distance_m !== undefined && r.distance_m !== null ? { distanceKm: Math.round(r.distance_m / 100) / 10, distanceSource: 'STRAIGHT_LINE_ESTIMATE' as const } : {}),
  };
}

interface OfferRow {
  id: string;
  assistance_request_id: string;
  donor_id: string;
  donor_name: string;
  donor_owner: string;
  offered_quantity: number;
  accepted_quantity: number | null;
  confirmed_quantity: number | null;
  food_name: string;
  category_id: string;
  dietary_type: 'VEG' | 'NON_VEG';
  pickup_available_from: Date;
  pickup_deadline: Date;
  lat: number;
  lng: number;
  address: string;
  notes: string | null;
  status: string;
  donation_id: string | null;
  rejection_reason: string | null;
  cancel_reason: string | null;
  created_at: Date;
  ready_prepared_at: string | null;
  ready_storage_type: string | null;
  allocation_id: string | null;
}

const OFFER_SELECT = `
  SELECT o.id, o.assistance_request_id, o.donor_id, dn.business_name AS donor_name, dn.owner_user_id AS donor_owner, o.offered_quantity,
         o.accepted_quantity, o.confirmed_quantity, o.food_name, o.category_id, o.dietary_type, o.pickup_available_from,
         o.pickup_deadline, ${latLngColumns('o.location')}, o.address, o.notes, o.status, o.donation_id, o.rejection_reason,
         o.cancel_reason, o.created_at,
         (SELECT a.metadata->>'preparedAt' FROM assistance_request_history a WHERE a.assistance_offer_id = o.id AND a.event_type = 'OFFER_PROPOSED' LIMIT 1) AS ready_prepared_at,
         (SELECT a.metadata->>'storageType' FROM assistance_request_history a WHERE a.assistance_offer_id = o.id AND a.event_type = 'OFFER_PROPOSED' LIMIT 1) AS ready_storage_type,
         (SELECT al.id FROM donation_allocations al WHERE al.assistance_offer_id = o.id) AS allocation_id
    FROM assistance_offers o JOIN donors dn ON dn.id = o.donor_id`;

function toOfferDto(o: OfferRow) {
  return {
    id: o.id,
    assistanceRequestId: o.assistance_request_id,
    donor: { id: o.donor_id, name: o.donor_name },
    offeredQuantity: o.offered_quantity,
    acceptedQuantity: o.accepted_quantity,
    confirmedQuantity: o.confirmed_quantity,
    foodName: o.food_name,
    dietaryType: o.dietary_type,
    pickupAvailableFrom: o.pickup_available_from,
    pickupDeadline: o.pickup_deadline,
    location: { lat: o.lat, lng: o.lng },
    address: o.address,
    notes: o.notes,
    readyNow: Boolean(o.ready_prepared_at),
    status: o.status,
    donationId: o.donation_id,
    allocationId: o.allocation_id,
    rejectionReason: o.rejection_reason,
    cancelReason: o.cancel_reason,
    createdAt: o.created_at,
  };
}

export interface AssistanceInput {
  categoryId: string;
  dietaryRequirement: 'VEG_ONLY' | 'ANY';
  quantityRequired: number;
  unit: string;
  neededFrom: Date;
  neededUntil: Date;
  location?: LatLng | undefined;
  address?: string | undefined;
  urgency: string;
  beneficiariesCount: number;
  reason?: string | undefined;
  additionalRequirements?: string | undefined;
}

export interface OfferInput {
  quantity: number;
  foodName: string;
  dietaryType: 'VEG' | 'NON_VEG';
  pickupAvailableFrom: Date;
  pickupDeadline: Date;
  location?: LatLng | undefined;
  address?: string | undefined;
  notes?: string | undefined;
  readyFood?: { preparedAt: Date; storageType: string; safetyConfirmed: true } | undefined;
}

/** Workflow B: NGO assistance requests, donor offers and partial fulfilment. */
export class AssistanceService {
  constructor(
    private readonly db: Database,
    private readonly allocations: AllocationService,
    private readonly fees: FeeService,
    private readonly notifications: NotificationService,
  ) {}

  private find(q: Queryable, id: string): Promise<RequestRow | undefined> {
    return one<RequestRow>(q, `${REQUEST_SELECT} WHERE f.id = $1 AND f.deleted_at IS NULL`, [id]);
  }

  private findOffer(q: Queryable, id: string): Promise<OfferRow | undefined> {
    return one<OfferRow>(q, `${OFFER_SELECT} WHERE o.id = $1`, [id]);
  }

  async create(auth: AuthContext, input: AssistanceInput, actor: Actor) {
    if (!auth.ngoId) throw forbidden();
    const ngo = await findNgoById(this.db, auth.ngoId);
    if (!ngo) throw notFound('NGO');
    // Enforced here as well as in the route middleware, so every caller (including the assistant) is covered.
    if (ngo.verification_status !== 'APPROVED') {
      throw forbidden('Your organisation must be verified by FoodBridge before you can do this.', 'ORGANISATION_NOT_APPROVED');
    }
    const location = input.location ?? (ngo.lat !== null && ngo.lng !== null ? { lat: ngo.lat, lng: ngo.lng } : undefined);
    const address = input.address ?? fallbackAddress(ngo.organization_name, ngo.address_line, ngo.city);
    if (!location) throw unprocessable('A delivery location is required. Add one to the request or your profile.', 'LOCATION_REQUIRED');
    if (!address || address.length < 5) throw unprocessable('An address is required.', 'ADDRESS_REQUIRED');
    if (input.neededUntil.getTime() <= Date.now() + 15 * 60_000) throw unprocessable('The required time window must end in the future.', 'WINDOW_IN_PAST');
    const id = await this.db.transaction(async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO food_assistance_requests (ngo_id, created_by, category_id, dietary_requirement, quantity_required, unit, needed_from,
                                              needed_until, location, address, urgency, beneficiaries_count, reason, additional_requirements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography, $11, $12, $13, $14, $15) RETURNING id`,
        [
          auth.ngoId,
          auth.userId,
          input.categoryId,
          input.dietaryRequirement,
          input.quantityRequired,
          input.unit,
          input.neededFrom,
          input.neededUntil,
          location.lng,
          location.lat,
          address,
          input.urgency,
          input.beneficiariesCount,
          input.reason ?? null,
          input.additionalRequirements ?? null,
        ],
      );
      if (!row) throw new Error('assistance request insert failed');
      await tx.query(
        `INSERT INTO assistance_request_history (assistance_request_id, event_type, to_status, quantity_delta, actor_user_id) VALUES ($1, 'CREATED', 'OPEN', 0, $2)`,
        [row.id, auth.userId],
      );
      await recordAudit(tx, actor, { action: 'assistance_request.created', entityType: 'assistance_request', entityId: row.id, changes: { ...input } });
      await enqueueJob(tx, MATCH_REQUEST_JOB, { requestId: row.id }, { dedupeKey: `match-request:${row.id}` });
      return row.id;
    });
    return toRequestDto((await this.find(this.db, id)) as RequestRow);
  }

  async list(auth: AuthContext, f: { status?: string | undefined; scope?: string | undefined; maxDistanceKm?: number | undefined; page: number; pageSize: number }) {
    const where = ['f.deleted_at IS NULL'];
    const v: unknown[] = [];
    let distance = 'NULL::float8 AS distance_m';
    const scope = f.scope ?? (auth.role === 'NGO' ? 'mine' : auth.role === 'DONOR' ? 'open' : 'all');
    if (scope === 'mine') {
      if (auth.role !== 'NGO') throw forbidden();
      where.push(`f.ngo_id = $${v.push(scopedNgoId(auth))}`);
    } else if (scope === 'open') {
      where.push(`f.status IN ('OPEN','PARTIALLY_FULFILLED')`, 'f.needed_until > now()');
      if (auth.role === 'DONOR' && auth.donorId) {
        const donor = await findDonorById(this.db, auth.donorId);
        if (donor && donor.lat !== null && donor.lng !== null) {
          distance = `ST_Distance(f.location, ST_SetSRID(ST_MakePoint($${v.push(donor.lng)}, $${v.push(donor.lat)}), 4326)::geography) AS distance_m`;
          if (f.maxDistanceKm) where.push(`ST_DWithin(f.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $${v.push(f.maxDistanceKm * 1000)})`);
        }
      }
    } else if (auth.role !== 'ADMIN') throw forbidden();
    if (f.status) where.push(`f.status = ANY($${v.push(f.status.split(','))}::text[])`);
    const w = where.join(' AND ');
    const order = distance.startsWith('NULL') ? 'f.created_at DESC' : 'distance_m ASC';
    const select = REQUEST_SELECT.replace('SELECT f.id,', `SELECT ${distance}, f.id,`);
    const rows = await many<RequestRow>(this.db, `${select} WHERE ${w} ORDER BY ${order} LIMIT $${v.length + 1} OFFSET $${v.length + 2}`, [
      ...v,
      f.pageSize,
      (f.page - 1) * f.pageSize,
    ]);
    // Count over the same query so every bound parameter (including the distance point) is referenced.
    const total = await one<{ n: number }>(this.db, `SELECT count(*) AS n FROM (${select} WHERE ${w}) x`, v);
    return { items: rows.map(toRequestDto), total: total?.n ?? 0 };
  }

  async get(auth: AuthContext, id: string) {
    const r = await this.find(this.db, id);
    if (!r) throw notFound('Assistance request');
    const ngoId = scopedNgoId(auth);
    const isOwner = auth.role === 'NGO' && ngoId === r.ngo_id;
    const ownOffers = auth.role === 'DONOR' ? await one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM assistance_offers WHERE assistance_request_id = $1 AND donor_id = $2', [id, auth.donorId]) : undefined;
    const open = ['OPEN', 'PARTIALLY_FULFILLED'].includes(r.status);
    if (!(auth.role === 'ADMIN' || isOwner || (auth.role === 'DONOR' && (open || (ownOffers?.n ?? 0) > 0)))) throw notFound('Assistance request');
    const offers = await many<OfferRow>(
      this.db,
      `${OFFER_SELECT} WHERE o.assistance_request_id = $1 ${auth.role === 'DONOR' ? 'AND o.donor_id = $2' : ''} ORDER BY o.created_at`,
      auth.role === 'DONOR' ? [id, auth.donorId] : [id],
    );
    return { ...toRequestDto(r), offers: offers.map(toOfferDto) };
  }

  async update(auth: AuthContext, id: string, patch: { version: number; quantityRequired?: number | undefined; neededFrom?: Date | undefined; neededUntil?: Date | undefined; urgency?: string | undefined; beneficiariesCount?: number | undefined; reason?: string | undefined; additionalRequirements?: string | undefined }, actor: Actor) {
    await this.db.transaction(async (tx) => {
      const r = await one<{ ngo_id: string; status: string; version: number; quantity_committed: number; quantity_required: number; needed_from: Date; needed_until: Date }>(
        tx,
        'SELECT ngo_id, status, version, quantity_committed, quantity_required, needed_from, needed_until FROM food_assistance_requests WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      if (!r || r.ngo_id !== auth.ngoId) throw notFound('Assistance request');
      if (r.version !== patch.version) throw conflict('This request was changed by someone else. Reload and try again.', 'STALE_VERSION', { currentVersion: r.version });
      if (!['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED'].includes(r.status)) throw conflict(`A ${r.status.toLowerCase()} request cannot be edited.`, 'REQUEST_NOT_EDITABLE');
      const required = patch.quantityRequired ?? r.quantity_required;
      if (required < r.quantity_committed) throw conflict(`Quantity cannot be lower than the ${r.quantity_committed} already committed by donors.`, 'QUANTITY_BELOW_COMMITTED');
      const from = patch.neededFrom ?? r.needed_from;
      const until = patch.neededUntil ?? r.needed_until;
      if (until <= from) throw unprocessable('neededUntil must be after neededFrom.', 'INVALID_WINDOW');
      const status = requestStatusFromQuantities(required, r.quantity_committed);
      assertTransition('assistance_request', r.status, status);
      await tx.query(
        `UPDATE food_assistance_requests SET quantity_required = $2, needed_from = $3, needed_until = $4, urgency = COALESCE($5, urgency),
                beneficiaries_count = COALESCE($6, beneficiaries_count), reason = COALESCE($7, reason),
                additional_requirements = COALESCE($8, additional_requirements), status = $9, version = version + 1 WHERE id = $1`,
        [id, required, from, until, patch.urgency ?? null, patch.beneficiariesCount ?? null, patch.reason ?? null, patch.additionalRequirements ?? null, status],
      );
      await tx.query(
        `INSERT INTO assistance_request_history (assistance_request_id, event_type, from_status, to_status, actor_user_id, metadata) VALUES ($1, 'UPDATED', $2, $3, $4, $5)`,
        [id, r.status, status, auth.userId, JSON.stringify(patch)],
      );
      await recordAudit(tx, actor, { action: 'assistance_request.updated', entityType: 'assistance_request', entityId: id, changes: { ...patch } });
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string, reason: string, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    await this.db.transaction(async (tx) => {
      const r = await one<{ ngo_id: string; status: string; ngo_name: string }>(
        tx,
        `SELECT f.ngo_id, f.status, n.organization_name AS ngo_name FROM food_assistance_requests f JOIN ngos n ON n.id = f.ngo_id WHERE f.id = $1 FOR UPDATE OF f`,
        [id],
      );
      if (!r || (auth.role !== 'ADMIN' && r.ngo_id !== auth.ngoId)) throw notFound('Assistance request');
      assertTransition('assistance_request', r.status, 'CANCELLED');
      // Lock the donations, then the allocations, behind this request's offers (the order every handover
      // uses) so a handover cannot commit between the "already collected" check and the cancellation.
      await tx.query(
        `SELECT 1 FROM donations WHERE id IN (SELECT a.donation_id FROM donation_allocations a JOIN assistance_offers o ON o.id = a.assistance_offer_id WHERE o.assistance_request_id = $1)
          ORDER BY id FOR UPDATE`,
        [id],
      );
      await tx.query(
        `SELECT 1 FROM donation_allocations a JOIN assistance_offers o ON o.id = a.assistance_offer_id WHERE o.assistance_request_id = $1 ORDER BY a.id FOR UPDATE OF a`,
        [id],
      );
      const picked = await one<{ n: number }>(
        tx,
        `SELECT count(*) AS n FROM donation_allocations a JOIN assistance_offers o ON o.id = a.assistance_offer_id
          WHERE o.assistance_request_id = $1 AND a.status IN ('PICKED_UP','IN_TRANSIT','COMPLETED','DISPUTED')`,
        [id],
      );
      if ((picked?.n ?? 0) > 0) throw conflict('Food for this request has already been collected; it cannot be cancelled.', 'REQUEST_ALREADY_COLLECTED');
      const offers = await many<{ id: string; status: string; donor_owner: string; allocation_id: string | null }>(
        tx,
        `SELECT o.id, o.status, dn.owner_user_id AS donor_owner, (SELECT a.id FROM donation_allocations a WHERE a.assistance_offer_id = o.id AND a.status IN ('RESERVED','PICKUP_ASSIGNED')) AS allocation_id
           FROM assistance_offers o JOIN donors dn ON dn.id = o.donor_id
          WHERE o.assistance_request_id = $1 AND o.status IN ('PROPOSED','ACCEPTED','RESERVED','PICKUP_ASSIGNED')`,
        [id],
      );
      const party = auth.role === 'ADMIN' ? 'ADMIN' : 'NGO';
      for (const o of offers) {
        if (o.allocation_id) {
          notices.push(...(await this.allocations.releaseAllocation(tx, o.allocation_id, { status: 'CANCELLED', party, reason: `assistance request cancelled: ${reason}` }, actor)));
        } else {
          await tx.query(`UPDATE assistance_offers SET status = $2, cancel_reason = $3, cancelled_by = $4 WHERE id = $1`, [o.id, o.status === 'PROPOSED' ? 'REJECTED' : 'CANCELLED', 'request cancelled', auth.userId]);
          notices.push(
            await this.notifications.create(tx, {
              userId: o.donor_owner,
              type: 'ASSISTANCE_REQUEST_CANCELLED',
              title: 'Assistance request cancelled',
              body: `${r.ngo_name} cancelled the request you offered food for${reason ? `: ${reason}` : '.'}`,
              linkPath: `/donor/assistance/${id}`,
              dedupeKey: `assistance-cancelled:${id}:${o.id}`,
            }),
          );
        }
      }
      await tx.query(`UPDATE food_assistance_requests SET status = 'CANCELLED', cancelled_at = now(), version = version + 1 WHERE id = $1`, [id]);
      await tx.query(
        `INSERT INTO assistance_request_history (assistance_request_id, event_type, from_status, to_status, actor_user_id, metadata) VALUES ($1, 'STATUS_CHANGED', $2, 'CANCELLED', $3, $4)`,
        [id, r.status, auth.userId, JSON.stringify({ reason })],
      );
      await recordAudit(tx, actor, { action: 'assistance_request.cancelled', entityType: 'assistance_request', entityId: id, changes: { reason } });
    });
    this.notifications.publish(notices);
    return this.get(auth, id);
  }

  // -------------------------------------------------------------------------
  // Donor offers
  // -------------------------------------------------------------------------

  async createOffer(auth: AuthContext, requestId: string, input: OfferInput, actor: Actor) {
    if (!auth.donorId) throw forbidden();
    const donor = await findDonorById(this.db, auth.donorId);
    if (!donor) throw notFound('Donor');
    const r = await this.find(this.db, requestId);
    if (!r || !['OPEN', 'PARTIALLY_FULFILLED'].includes(r.status) || r.needed_until <= new Date()) {
      throw conflict('This request is no longer open for offers.', 'REQUEST_NOT_OPEN');
    }
    if (r.dietary_requirement === 'VEG_ONLY' && input.dietaryType !== 'VEG') {
      throw unprocessable('This NGO needs vegetarian food only.', 'DIETARY_INCOMPATIBLE');
    }
    if (input.quantity > r.quantity_required) throw unprocessable(`The NGO needs ${r.quantity_required} in total.`, 'OFFER_EXCEEDS_REQUIREMENT');
    if (input.pickupDeadline.getTime() <= Date.now()) throw unprocessable('The pickup deadline must be in the future.', 'DEADLINE_IN_PAST');
    if (input.readyFood && input.readyFood.preparedAt.getTime() > Date.now() + 5 * 60_000) {
      throw unprocessable('Preparation time cannot be in the future for food that is ready now.', 'PREPARED_IN_FUTURE');
    }
    const location = input.location ?? (donor.lat !== null && donor.lng !== null ? { lat: donor.lat, lng: donor.lng } : undefined);
    const address = input.address ?? fallbackAddress(donor.business_name, donor.address_line, donor.city);
    if (!location || !address || address.length < 5) throw unprocessable('A pickup location and address are required.', 'LOCATION_REQUIRED');

    const { offerId, notice } = await this.db.transaction(async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO assistance_offers (assistance_request_id, donor_id, created_by, offered_quantity, food_name, category_id, dietary_type,
                                        pickup_available_from, pickup_deadline, location, address, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography, $12, $13) RETURNING id`,
        [requestId, auth.donorId, auth.userId, input.quantity, input.foodName, r.category_id, input.dietaryType, input.pickupAvailableFrom, input.pickupDeadline, location.lng, location.lat, address, input.notes ?? null],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') throw conflict('You already have an active offer for this request.', 'DUPLICATE_OFFER');
        throw err;
      });
      if (!row) throw new Error('offer insert failed');
      await tx.query(
        `INSERT INTO assistance_request_history (assistance_request_id, assistance_offer_id, event_type, quantity_delta, actor_user_id, metadata)
         VALUES ($1, $2, 'OFFER_PROPOSED', 0, $3, $4)`,
        [requestId, row.id, auth.userId, JSON.stringify(input.readyFood ? { preparedAt: input.readyFood.preparedAt.toISOString(), storageType: input.readyFood.storageType, offeredQuantity: input.quantity } : { offeredQuantity: input.quantity })],
      );
      await tx.query(
        `UPDATE match_recommendations SET response = 'OFFERED', responded_at = now() WHERE assistance_request_id = $1 AND candidate_donor_id = $2 AND response = 'NONE'`,
        [requestId, auth.donorId],
      );
      await recordAudit(tx, actor, { action: 'assistance_offer.created', entityType: 'assistance_offer', entityId: row.id, metadata: { requestId, quantity: input.quantity, readyNow: Boolean(input.readyFood) } });
      const n = await this.notifications.create(tx, {
        userId: r.ngo_owner,
        type: 'OFFER_RECEIVED',
        title: 'New food offer',
        body: `${donor.business_name} offered ${input.quantity} ${unitLabel(r.unit, input.quantity)} of ${input.foodName} for your request (pickup ${formatDateTime(input.pickupAvailableFrom)}–${formatTime(input.pickupDeadline)}).`,
        linkPath: `/ngo/assistance/${requestId}`,
        priority: 'HIGH',
        dedupeKey: `offer-received:${row.id}`,
        email: true,
      });
      return { offerId: row.id, notice: n };
    });
    this.notifications.publish([notice]);
    return toOfferDto((await this.findOffer(this.db, offerId)) as OfferRow);
  }

  /** A donor declines, or marks themselves unavailable for, a request they were matched to. */
  async respond(auth: AuthContext, requestId: string, response: 'DECLINED' | 'UNAVAILABLE', actor: Actor) {
    if (!auth.donorId) throw forbidden();
    const res = await this.db.query(
      `UPDATE match_recommendations SET response = $3, responded_at = now()
        WHERE assistance_request_id = $1 AND candidate_donor_id = $2 AND response = 'NONE'`,
      [requestId, auth.donorId, response],
    );
    await recordAudit(this.db, actor, { action: `assistance_request.donor_${response.toLowerCase()}`, entityType: 'assistance_request', entityId: requestId });
    return { updated: res.rowCount ?? 0 };
  }

  /**
   * NGO accepts an offer, committing quantity against the request under a row
   * lock so concurrent acceptances can never exceed the requirement. Food that
   * is already ready is reserved in the same transaction.
   */
  async acceptOffer(auth: AuthContext, offerId: string, quantity: number | undefined, actor: Actor) {
    const result = await this.db.transaction(async (tx) => {
      const pre = await this.findOffer(tx, offerId);
      if (!pre) throw notFound('Offer');
      const r = await one<{ ngo_id: string; status: string; quantity_required: number; quantity_committed: number; unit: string; needed_until: Date }>(
        tx,
        'SELECT ngo_id, status, quantity_required, quantity_committed, unit, needed_until FROM food_assistance_requests WHERE id = $1 FOR UPDATE',
        [pre.assistance_request_id],
      );
      if (!r || r.ngo_id !== auth.ngoId) throw notFound('Offer');
      await tx.query('SELECT 1 FROM assistance_offers WHERE id = $1 FOR UPDATE', [offerId]);
      const o = (await this.findOffer(tx, offerId)) as OfferRow;
      if (o.status !== 'PROPOSED') throw conflict(`This offer is already ${o.status.toLowerCase()}.`, 'OFFER_NOT_PROPOSED');
      if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(r.status)) throw conflict('This request is already fulfilled or closed.', 'REQUEST_NOT_OPEN');
      const remaining = r.quantity_required - r.quantity_committed;
      if (remaining <= 0) throw conflict('This request is already fully covered.', 'ALREADY_FULFILLED');
      const accepted = Math.min(quantity ?? o.offered_quantity, o.offered_quantity, remaining);
      if (accepted <= 0) throw unprocessable('Accepted quantity must be positive.', 'INVALID_QUANTITY');
      await tx.query(`UPDATE assistance_offers SET status = 'ACCEPTED', accepted_quantity = $2, responded_by = $3, responded_at = now() WHERE id = $1`, [offerId, accepted, auth.userId]);
      await this.allocations.adjustRequestCommitment(tx, o.assistance_request_id, accepted, actor, offerId, 'OFFER_ACCEPTED');
      await recordAudit(tx, actor, { action: 'assistance_offer.accepted', entityType: 'assistance_offer', entityId: offerId, changes: { acceptedQuantity: accepted } });
      let allocationId: string | null = null;
      if (o.ready_prepared_at && o.ready_storage_type) {
        allocationId = await this.reserveOffer(tx, o, accepted, new Date(o.ready_prepared_at), o.ready_storage_type, undefined, actor);
      }
      const n = await this.notifications.create(tx, {
        userId: o.donor_owner,
        type: 'OFFER_ACCEPTED',
        title: 'Your offer was accepted',
        body: allocationId
          ? `Your offer of ${accepted} ${unitLabel(r.unit, accepted)} of ${o.food_name} was accepted and reserved. The NGO will assign a representative to collect it.`
          : `Your offer of ${accepted} ${unitLabel(r.unit, accepted)} of ${o.food_name} was accepted. Confirm the actual food when it is ready so it can be reserved.`,
        linkPath: `/donor/assistance/${o.assistance_request_id}`,
        priority: 'HIGH',
        dedupeKey: `offer-accepted:${offerId}`,
        email: true,
      });
      return { accepted, allocationId, notice: n, unit: r.unit };
    });
    this.notifications.publish([result.notice]);
    const offer = toOfferDto((await this.findOffer(this.db, offerId)) as OfferRow);
    return { ...offer, feeEstimate: await this.fees.estimate(result.unit, result.accepted) };
  }

  /** Creates the actual donation + allocation for a confirmed offer (prediction ≠ donation: only confirmed food is reserved). */
  private async reserveOffer(tx: Queryable, o: OfferRow, quantity: number, preparedAt: Date, storageType: string, storageNotes: string | undefined, actor: Actor): Promise<string> {
    const r = await one<{ ngo_id: string; unit: string }>(tx, 'SELECT ngo_id, unit FROM food_assistance_requests WHERE id = $1', [o.assistance_request_id]);
    if (!r) throw notFound('Assistance request');
    const donationId = await insertDonation(tx, {
      donorId: o.donor_id,
      origin: 'ASSISTANCE_OFFER',
      foodName: o.food_name,
      categoryId: o.category_id,
      dietaryType: o.dietary_type,
      quantity,
      unit: r.unit,
      reservedQuantity: quantity,
      preparedAt,
      storageType,
      storageNotes,
      pickupAvailableFrom: o.pickup_available_from,
      pickupDeadline: o.pickup_deadline,
      location: { lat: o.lat, lng: o.lng },
      address: o.address,
      safetyConfirmed: true,
      status: 'RESERVED',
    });
    await insertDonationHistory(tx, donationId, null, 'RESERVED', actor.userId, 'created from confirmed assistance offer', { offerId: o.id });
    const allocationId = await this.allocations.createAllocation(tx, { donationId, ngoId: r.ngo_id, quantity, source: 'ASSISTANCE_OFFER', assistanceOfferId: o.id });
    await tx.query(`UPDATE assistance_offers SET status = 'RESERVED', confirmed_quantity = $2, donation_id = $3 WHERE id = $1`, [o.id, quantity, donationId]);
    await tx.query(
      `INSERT INTO assistance_request_history (assistance_request_id, assistance_offer_id, event_type, from_status, to_status, quantity_delta, actor_user_id)
       VALUES ($1, $2, 'OFFER_RESERVED', 'ACCEPTED', 'RESERVED', 0, $3)`,
      [o.assistance_request_id, o.id, actor.userId],
    );
    await recordAudit(tx, actor, { action: 'assistance_offer.reserved', entityType: 'assistance_offer', entityId: o.id, changes: { quantity, donationId, allocationId } });
    return allocationId;
  }

  /** Donor confirms the actual food for an accepted offer; a smaller quantity releases the difference back to the request. */
  async confirmOffer(auth: AuthContext, offerId: string, input: { confirmedQuantity: number; preparedAt: Date; storageType: string; storageNotes?: string | undefined }, actor: Actor) {
    if (input.preparedAt.getTime() > Date.now() + 5 * 60_000) throw unprocessable('Preparation time cannot be in the future.', 'PREPARED_IN_FUTURE');
    const notice = await this.db.transaction(async (tx) => {
      const pre = await this.findOffer(tx, offerId);
      if (!pre || pre.donor_id !== auth.donorId) throw notFound('Offer');
      await tx.query('SELECT 1 FROM food_assistance_requests WHERE id = $1 FOR UPDATE', [pre.assistance_request_id]);
      await tx.query('SELECT 1 FROM assistance_offers WHERE id = $1 FOR UPDATE', [offerId]);
      const o = (await this.findOffer(tx, offerId)) as OfferRow;
      assertTransition('offer', o.status, 'RESERVED');
      if (o.status !== 'ACCEPTED' || o.accepted_quantity === null) throw conflict('Only accepted offers can be confirmed.', 'OFFER_NOT_ACCEPTED');
      if (input.confirmedQuantity > o.accepted_quantity) throw unprocessable(`You can confirm at most the accepted ${o.accepted_quantity}.`, 'CONFIRMATION_EXCEEDS_ACCEPTED');
      if (o.pickup_deadline <= new Date()) throw conflict('The pickup deadline for this offer has passed.', 'OFFER_DEADLINE_PASSED');
      const shortfall = o.accepted_quantity - input.confirmedQuantity;
      if (shortfall > 0) await this.allocations.adjustRequestCommitment(tx, o.assistance_request_id, -shortfall, actor, offerId, 'OFFER_REDUCED');
      await this.reserveOffer(tx, o, input.confirmedQuantity, input.preparedAt, input.storageType, input.storageNotes, actor);
      const r = await one<{ ngo_owner: string; unit: string }>(tx, 'SELECT n.owner_user_id AS ngo_owner, f.unit FROM food_assistance_requests f JOIN ngos n ON n.id = f.ngo_id WHERE f.id = $1', [o.assistance_request_id]);
      return this.notifications.create(tx, {
        userId: r?.ngo_owner as string,
        type: 'OFFER_CONFIRMED',
        title: 'Food confirmed and reserved',
        body: `${o.donor_name} confirmed ${input.confirmedQuantity} ${unitLabel(r?.unit ?? 'MEALS', input.confirmedQuantity)} of ${o.food_name}${shortfall > 0 ? ` (${shortfall} fewer than accepted; that quantity is open again)` : ''}. Assign a representative to collect it.`,
        linkPath: `/ngo/assistance/${o.assistance_request_id}`,
        priority: 'HIGH',
        dedupeKey: `offer-confirmed:${offerId}`,
        email: true,
      });
    });
    this.notifications.publish([notice]);
    return toOfferDto((await this.findOffer(this.db, offerId)) as OfferRow);
  }

  async rejectOffer(auth: AuthContext, offerId: string, reason: string | undefined, actor: Actor) {
    const notice = await this.db.transaction(async (tx) => {
      const o = await this.findOffer(tx, offerId);
      if (!o) throw notFound('Offer');
      const r = await one<{ ngo_id: string }>(tx, 'SELECT ngo_id FROM food_assistance_requests WHERE id = $1', [o.assistance_request_id]);
      if (r?.ngo_id !== auth.ngoId) throw notFound('Offer');
      await tx.query('SELECT 1 FROM assistance_offers WHERE id = $1 FOR UPDATE', [offerId]);
      const cur = await one<{ status: string }>(tx, 'SELECT status FROM assistance_offers WHERE id = $1', [offerId]);
      if (cur?.status !== 'PROPOSED') throw conflict('Only proposed offers can be rejected.', 'OFFER_NOT_PROPOSED');
      await tx.query(`UPDATE assistance_offers SET status = 'REJECTED', rejection_reason = $2, responded_by = $3, responded_at = now() WHERE id = $1`, [offerId, reason ?? null, auth.userId]);
      await tx.query(
        `INSERT INTO assistance_request_history (assistance_request_id, assistance_offer_id, event_type, from_status, to_status, actor_user_id) VALUES ($1, $2, 'OFFER_REJECTED', 'PROPOSED', 'REJECTED', $3)`,
        [o.assistance_request_id, offerId, auth.userId],
      );
      await recordAudit(tx, actor, { action: 'assistance_offer.rejected', entityType: 'assistance_offer', entityId: offerId, changes: { reason } });
      return this.notifications.create(tx, {
        userId: o.donor_owner,
        type: 'OFFER_REJECTED',
        title: 'Offer not accepted',
        body: `Your offer of ${o.food_name} was not accepted${reason ? `: ${reason}` : '.'} Thank you for offering.`,
        linkPath: `/donor/assistance/${o.assistance_request_id}`,
        dedupeKey: `offer-rejected:${offerId}`,
      });
    });
    this.notifications.publish([notice]);
  }

  /** Donor withdraws an offer (before pickup). Committed quantity returns to the request. */
  async cancelOffer(auth: AuthContext, offerId: string, reason: string, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    await this.db.transaction(async (tx) => {
      const o = await this.findOffer(tx, offerId);
      if (!o || o.donor_id !== auth.donorId) throw notFound('Offer');
      await tx.query('SELECT 1 FROM food_assistance_requests WHERE id = $1 FOR UPDATE', [o.assistance_request_id]);
      await tx.query('SELECT 1 FROM assistance_offers WHERE id = $1 FOR UPDATE', [offerId]);
      const cur = (await this.findOffer(tx, offerId)) as OfferRow;
      assertTransition('offer', cur.status, 'CANCELLED');
      if (cur.allocation_id) {
        notices.push(...(await this.allocations.releaseAllocation(tx, cur.allocation_id, { status: 'CANCELLED', party: 'DONOR', reason }, actor)));
        return;
      }
      const committed = cur.status === 'ACCEPTED' ? (cur.accepted_quantity ?? 0) : 0;
      await tx.query(`UPDATE assistance_offers SET status = 'CANCELLED', cancel_reason = $2, cancelled_by = $3 WHERE id = $1`, [offerId, reason, auth.userId]);
      if (committed > 0) await this.allocations.adjustRequestCommitment(tx, cur.assistance_request_id, -committed, actor, offerId, 'OFFER_CANCELLED');
      await recordAudit(tx, actor, { action: 'assistance_offer.cancelled', entityType: 'assistance_offer', entityId: offerId, changes: { reason } });
      const ngo = await one<{ owner: string }>(tx, 'SELECT n.owner_user_id AS owner FROM food_assistance_requests f JOIN ngos n ON n.id = f.ngo_id WHERE f.id = $1', [cur.assistance_request_id]);
      notices.push(
        await this.notifications.create(tx, {
          userId: ngo?.owner as string,
          type: 'OFFER_CANCELLED',
          title: 'Offer withdrawn',
          body: `${cur.donor_name} withdrew their offer of ${cur.food_name}${reason ? `: ${reason}` : '.'}`,
          linkPath: `/ngo/assistance/${cur.assistance_request_id}`,
          priority: 'HIGH',
          dedupeKey: `offer-cancelled:${offerId}`,
        }),
      );
    });
    this.notifications.publish(notices);
  }

  async listOffers(auth: AuthContext, requestId: string) {
    return (await this.get(auth, requestId)).offers;
  }

  /** A donor's own offers across requests. */
  async myOffers(auth: AuthContext) {
    if (!auth.donorId) throw forbidden();
    const rows = await many<OfferRow & { ngo_name: string; unit: string; needed_from: Date; request_status: string }>(
      this.db,
      `${OFFER_SELECT.replace('FROM assistance_offers o JOIN donors dn ON dn.id = o.donor_id', `, n.organization_name AS ngo_name, f.unit, f.needed_from, f.status AS request_status
         FROM assistance_offers o JOIN donors dn ON dn.id = o.donor_id JOIN food_assistance_requests f ON f.id = o.assistance_request_id JOIN ngos n ON n.id = f.ngo_id`)}
        WHERE o.donor_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
      [auth.donorId],
    );
    return rows.map((r) => ({ ...toOfferDto(r), ngoName: r.ngo_name, unit: r.unit, neededFrom: r.needed_from, requestStatus: r.request_status }));
  }
}
