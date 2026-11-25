import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import { assertTransition, donationStatusFromQuantities } from '../domain/state-machines.js';
import { enqueueJob } from '../jobs/queue.js';
import {
  DONATION_SELECT,
  availableQuantity,
  findDonation,
  insertDonation,
  insertDonationHistory,
  toDonationDto,
  type DonationRow,
} from '../repositories/donation.repository.js';
import { findDonorById, findNgoById } from '../repositories/organisation.repository.js';
import { type Actor, type AuthContext, scopedNgoId } from '../types/auth.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { formatDateTime } from '../utils/format.js';
import type { LatLng } from '../validators/common.js';
import type { AllocationService } from './allocation.service.js';
import { fallbackAddress } from './assistance.service.js';
import { recordAudit } from './audit.service.js';
import type { FeeService } from './fee.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';
import type { SettingsService } from './settings.service.js';

export const MATCH_DONATION_JOB = 'match-donation';

export interface DonationInput {
  foodName: string;
  categoryId: string;
  dietaryType: 'VEG' | 'NON_VEG';
  quantity: number;
  unit: 'MEALS' | 'PACKETS' | 'BOXES';
  preparedAt: Date;
  bestBefore?: Date | undefined;
  storageType: string;
  storageNotes?: string | undefined;
  pickupAvailableFrom?: Date | undefined;
  pickupDeadline: Date;
  location?: LatLng | undefined;
  address?: string | undefined;
  description?: string | undefined;
  safetyConfirmed: boolean;
  publish: boolean;
}

const MAX_FUTURE_PREPARATION_MS = 5 * 60_000;

/** Non-blocking review flags. They never certify or reject food; humans decide. */
function reviewWarnings(d: { category_review_hours: number | null; category_name: string; prepared_at: Date; pickup_deadline: Date; storage_type: string; category_requires_refrigeration: boolean }): string[] {
  const warnings: string[] = [];
  if (d.category_review_hours) {
    const hours = (d.pickup_deadline.getTime() - d.prepared_at.getTime()) / 3_600_000;
    if (hours > d.category_review_hours) {
      warnings.push(
        `The pickup deadline is ${hours.toFixed(1)} h after preparation. FoodBridge flags ${d.category_name.toLowerCase()} beyond ${d.category_review_hours} h for extra care. Food safety remains the donor's responsibility.`,
      );
    }
  }
  if (d.category_requires_refrigeration && !['REFRIGERATED', 'FROZEN'].includes(d.storage_type)) {
    warnings.push(`${d.category_name} usually needs refrigeration, but the storage type is ${d.storage_type.replace('_', ' ').toLowerCase()}.`);
  }
  return warnings;
}

export class DonationService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly allocations: AllocationService,
    private readonly fees: FeeService,
    private readonly notifications: NotificationService,
  ) {}

  async create(auth: AuthContext, input: DonationInput, actor: Actor) {
    if (!auth.donorId) throw forbidden();
    const donor = await findDonorById(this.db, auth.donorId);
    if (!donor) throw notFound('Donor');
    const location = input.location ?? (donor.lat !== null && donor.lng !== null ? { lat: donor.lat, lng: donor.lng } : undefined);
    const address = input.address ?? fallbackAddress(donor.business_name, donor.address_line, donor.city);
    if (!location) throw unprocessable('A pickup location is required. Add one to the donation or your profile.', 'LOCATION_REQUIRED');
    if (!address || address.length < 5) throw unprocessable('A pickup address is required.', 'ADDRESS_REQUIRED');
    const now = Date.now();
    if (input.preparedAt.getTime() > now + MAX_FUTURE_PREPARATION_MS) {
      throw unprocessable('Preparation time cannot be in the future. Donations must describe food that already exists.', 'PREPARED_IN_FUTURE');
    }
    const minLead = await this.settings.get('matching.min_lead_minutes');
    if (input.pickupDeadline.getTime() <= now + minLead * 60_000) {
      throw unprocessable(`The pickup deadline must be at least ${minLead} minutes from now.`, 'DEADLINE_TOO_SOON');
    }
    const pickupAvailableFrom = input.pickupAvailableFrom ?? new Date(now);
    if (input.pickupDeadline <= pickupAvailableFrom) throw unprocessable('The pickup deadline must be after the pickup start time.', 'INVALID_PICKUP_WINDOW');
    if (input.publish && !input.safetyConfirmed) {
      throw unprocessable('Confirm that the food is fit for donation before publishing.', 'SAFETY_CONFIRMATION_REQUIRED');
    }
    const category = await one<{ id: string }>(this.db, 'SELECT id FROM food_categories WHERE id = $1 AND is_active', [input.categoryId]);
    if (!category) throw badRequest('Unknown food category.', undefined, 'UNKNOWN_CATEGORY');

    const status = input.publish ? 'AVAILABLE' : 'DRAFT';
    const id = await this.db.transaction(async (tx) => {
      const donationId = await insertDonation(tx, {
        donorId: auth.donorId as string,
        origin: 'DIRECT_LISTING',
        foodName: input.foodName,
        categoryId: input.categoryId,
        dietaryType: input.dietaryType,
        quantity: input.quantity,
        unit: input.unit,
        preparedAt: input.preparedAt,
        bestBefore: input.bestBefore,
        storageType: input.storageType,
        storageNotes: input.storageNotes,
        pickupAvailableFrom,
        pickupDeadline: input.pickupDeadline,
        location,
        address,
        description: input.description,
        safetyConfirmed: input.safetyConfirmed,
        status,
      });
      await insertDonationHistory(tx, donationId, null, status, auth.userId, 'created');
      await recordAudit(tx, actor, {
        action: 'donation.created',
        entityType: 'donation',
        entityId: donationId,
        changes: { foodName: input.foodName, quantity: input.quantity, unit: input.unit, status },
      });
      if (status === 'AVAILABLE') await enqueueJob(tx, MATCH_DONATION_JOB, { donationId }, { dedupeKey: `match-donation:${donationId}` });
      return donationId;
    });
    const created = (await findDonation(this.db, id)) as DonationRow;
    return { ...toDonationDto(created), warnings: reviewWarnings(created) };
  }

  /** Role-aware listing: donors see their own; NGOs see the open marketplace; admins see everything. */
  async list(
    auth: AuthContext,
    f: { status?: string | undefined; categoryId?: string | undefined; dietaryType?: string | undefined; maxDistanceKm?: number | undefined; sort: string; scope?: string | undefined; page: number; pageSize: number },
  ) {
    const where: string[] = ['d.deleted_at IS NULL'];
    const v: unknown[] = [];
    let distanceSelect = 'NULL::float8 AS distance_m';
    const scope = f.scope ?? (auth.role === 'DONOR' ? 'mine' : auth.role === 'NGO' ? 'marketplace' : 'all');
    if (scope === 'mine') {
      if (auth.role !== 'DONOR') throw forbidden();
      where.push(`d.donor_id = $${v.push(auth.donorId)}`);
    } else if (scope === 'marketplace') {
      if (auth.role === 'DONOR') throw forbidden('Donors see their own donations.');
      where.push(`d.origin = 'DIRECT_LISTING'`, `d.status IN ('AVAILABLE','PARTIALLY_RESERVED')`, 'd.pickup_deadline > now()');
      const ngoId = scopedNgoId(auth);
      if (ngoId) {
        const ngo = await findNgoById(this.db, ngoId);
        if (ngo?.lat !== null && ngo?.lat !== undefined && ngo.lng !== null) {
          distanceSelect = `ST_Distance(d.location, ST_SetSRID(ST_MakePoint($${v.push(ngo.lng)}, $${v.push(ngo.lat)}), 4326)::geography) AS distance_m`;
          if (f.maxDistanceKm) where.push(`ST_DWithin(d.location, ST_SetSRID(ST_MakePoint($${v.length - 1}, $${v.length}), 4326)::geography, $${v.push(f.maxDistanceKm * 1000)})`);
        }
      }
    } else if (auth.role !== 'ADMIN') throw forbidden();
    if (f.status) where.push(`d.status = ANY($${v.push(f.status.split(','))}::text[])`);
    if (f.categoryId) where.push(`d.category_id = $${v.push(f.categoryId)}`);
    if (f.dietaryType) where.push(`d.dietary_type = $${v.push(f.dietaryType)}`);
    const order = f.sort === 'distance' && distanceSelect !== 'NULL::float8 AS distance_m' ? 'distance_m ASC NULLS LAST' : f.sort === 'deadline' ? 'd.pickup_deadline ASC' : 'd.created_at DESC';
    const w = where.join(' AND ');
    const selectWithDistance = DONATION_SELECT.replace('SELECT d.id,', `SELECT ${distanceSelect}, d.id,`);
    const rows = await many<DonationRow>(this.db, `${selectWithDistance} WHERE ${w} ORDER BY ${order} LIMIT $${v.length + 1} OFFSET $${v.length + 2}`, [
      ...v,
      f.pageSize,
      (f.page - 1) * f.pageSize,
    ]);
    // Count over the same query so every bound parameter (including the distance point) is referenced.
    const total = await one<{ n: number }>(this.db, `SELECT count(*) AS n FROM (${selectWithDistance} WHERE ${w}) x`, v);
    return { items: rows.map(toDonationDto), total: total?.n ?? 0 };
  }

  /** Visibility: owner donor, admins, NGOs for listed donations or ones they are involved in. */
  async get(auth: AuthContext, id: string) {
    const d = await findDonation(this.db, id);
    if (!d) throw notFound('Donation');
    const ngoId = scopedNgoId(auth);
    const isOwner = auth.role === 'DONOR' && auth.donorId === d.donor_id;
    let involved = false;
    if (auth.role === 'NGO' && ngoId) {
      const r = await one<{ n: number }>(
        this.db,
        `SELECT (SELECT count(*) FROM donation_allocations WHERE donation_id = $1 AND ngo_id = $2)
              + (SELECT count(*) FROM donation_requests WHERE donation_id = $1 AND ngo_id = $2) AS n`,
        [id, ngoId],
      );
      involved = (r?.n ?? 0) > 0;
    }
    const listed = d.origin === 'DIRECT_LISTING' && d.status !== 'DRAFT';
    if (!(auth.role === 'ADMIN' || isOwner || involved || (auth.role === 'NGO' && listed))) throw notFound('Donation');

    const dto = { ...toDonationDto(d), warnings: isOwner || auth.role === 'ADMIN' ? reviewWarnings(d) : [] };
    const history =
      isOwner || auth.role === 'ADMIN'
        ? await many<{ from_status: string | null; to_status: string; reason: string | null; created_at: Date }>(
            this.db,
            'SELECT from_status, to_status, reason, created_at FROM donation_status_history WHERE donation_id = $1 ORDER BY id',
            [id],
          )
        : [];
    const requestFilter = isOwner || auth.role === 'ADMIN' ? '' : 'AND r.ngo_id = $2';
    const requests = await many<Record<string, unknown>>(
      this.db,
      `SELECT r.id, r.ngo_id, n.organization_name AS ngo_name, r.requested_quantity, r.approved_quantity, r.message, r.status, r.created_at, r.decided_at, r.decision_reason
         FROM donation_requests r JOIN ngos n ON n.id = r.ngo_id WHERE r.donation_id = $1 ${requestFilter} ORDER BY r.created_at`,
      isOwner || auth.role === 'ADMIN' ? [id] : [id, ngoId],
    );
    const allocations = await many<Record<string, unknown>>(
      this.db,
      `SELECT a.id, a.ngo_id, n.organization_name AS ngo_name, a.quantity, a.status, a.source, a.handed_over_quantity, a.created_at
         FROM donation_allocations a JOIN ngos n ON n.id = a.ngo_id WHERE a.donation_id = $1 ${isOwner || auth.role === 'ADMIN' ? '' : 'AND a.ngo_id = $2'} ORDER BY a.created_at`,
      isOwner || auth.role === 'ADMIN' ? [id] : [id, ngoId],
    );
    return {
      ...dto,
      history: history.map((h) => ({ from: h.from_status, to: h.to_status, reason: h.reason, at: h.created_at })),
      requests: requests.map((r) => ({
        id: r.id,
        ngo: { id: r.ngo_id, name: r.ngo_name },
        requestedQuantity: r.requested_quantity,
        approvedQuantity: r.approved_quantity,
        message: r.message,
        status: r.status,
        createdAt: r.created_at,
        decidedAt: r.decided_at,
        decisionReason: r.decision_reason,
      })),
      allocations: allocations.map((a) => ({
        id: a.id,
        ngo: { id: a.ngo_id, name: a.ngo_name },
        quantity: a.quantity,
        status: a.status,
        source: a.source,
        handedOverQuantity: a.handed_over_quantity,
        createdAt: a.created_at,
      })),
    };
  }

  /** Edits use optimistic locking (`version`). Quantity can never drop below what is already reserved. */
  async update(
    auth: AuthContext,
    id: string,
    patch: {
      version: number;
      foodName?: string | undefined;
      quantity?: number | undefined;
      storageType?: string | undefined;
      storageNotes?: string | undefined;
      pickupAvailableFrom?: Date | undefined;
      pickupDeadline?: Date | undefined;
      description?: string | undefined;
      safetyConfirmed?: boolean | undefined;
      publish?: boolean | undefined;
    },
    actor: Actor,
  ) {
    const minLead = await this.settings.get('matching.min_lead_minutes');
    await this.db.transaction(async (tx) => {
      const d = await findDonation(tx, id, true);
      if (!d || d.donor_id !== auth.donorId) throw notFound('Donation');
      if (d.version !== patch.version) throw conflict('This donation was changed by someone else. Reload and try again.', 'STALE_VERSION', { currentVersion: d.version });
      if (!['DRAFT', 'AVAILABLE', 'PARTIALLY_RESERVED'].includes(d.status)) {
        throw conflict(`A donation in status ${d.status} can no longer be edited.`, 'DONATION_NOT_EDITABLE');
      }
      const quantity = patch.quantity ?? d.quantity;
      if (quantity < d.reserved_quantity) {
        throw conflict(`Quantity cannot be lower than the ${d.reserved_quantity} already reserved.`, 'QUANTITY_BELOW_RESERVED');
      }
      const deadline = patch.pickupDeadline ?? d.pickup_deadline;
      const from = patch.pickupAvailableFrom ?? d.pickup_available_from;
      if (patch.pickupDeadline && deadline.getTime() <= Date.now() + minLead * 60_000) {
        throw unprocessable(`The pickup deadline must be at least ${minLead} minutes from now.`, 'DEADLINE_TOO_SOON');
      }
      if (deadline <= from) throw unprocessable('The pickup deadline must be after the pickup start time.', 'INVALID_PICKUP_WINDOW');
      const safety = patch.safetyConfirmed ?? d.safety_confirmed;
      let status = d.status;
      if (d.status === 'DRAFT' && patch.publish) {
        if (!safety) throw unprocessable('Confirm that the food is fit for donation before publishing.', 'SAFETY_CONFIRMATION_REQUIRED');
        status = 'AVAILABLE';
      }
      if (status !== 'DRAFT') status = donationStatusFromQuantities(quantity, d.reserved_quantity);
      assertTransition('donation', d.status, status);
      await tx.query(
        `UPDATE donations SET food_name = $2, quantity = $3, storage_type = $4, storage_notes = $5, pickup_available_from = $6,
                pickup_deadline = $7, description = $8, safety_confirmed = $9,
                safety_confirmed_at = CASE WHEN $9 AND safety_confirmed_at IS NULL THEN now() ELSE safety_confirmed_at END,
                status = $10, version = version + 1
          WHERE id = $1`,
        [
          id,
          patch.foodName ?? d.food_name,
          quantity,
          patch.storageType ?? d.storage_type,
          patch.storageNotes ?? d.storage_notes,
          from,
          deadline,
          patch.description ?? d.description,
          safety,
          status,
        ],
      );
      // Allocations may already be picked up or completed; let them decide the final status (not just quantities).
      if (status !== 'DRAFT' && d.reserved_quantity > 0) await this.allocations.rollupDonationStatus(tx, id, auth.userId, 'donation edited');
      if (status !== d.status) await insertDonationHistory(tx, id, d.status, status, auth.userId, d.status === 'DRAFT' ? 'published' : 'updated');
      await recordAudit(tx, actor, { action: 'donation.updated', entityType: 'donation', entityId: id, changes: { ...patch } });
      if (d.status === 'DRAFT' && status === 'AVAILABLE') {
        await enqueueJob(tx, MATCH_DONATION_JOB, { donationId: id }, { dedupeKey: `match-donation:${id}` });
      }
    });
    return this.get(auth, id);
  }

  /** Cancels a donation; reservations that have not been picked up are released and the NGOs notified. */
  async cancel(auth: AuthContext, id: string, reason: string, actor: Actor) {
    const notices: (NotificationRow | null)[] = [];
    await this.db.transaction(async (tx) => {
      const d = await findDonation(tx, id, true);
      if (!d || (auth.role !== 'ADMIN' && d.donor_id !== auth.donorId)) throw notFound('Donation');
      const progressed = await one<{ n: number }>(
        tx,
        `SELECT count(*) AS n FROM donation_allocations WHERE donation_id = $1 AND status IN ('PICKED_UP','IN_TRANSIT','COMPLETED','DISPUTED')`,
        [id],
      );
      if ((progressed?.n ?? 0) > 0) throw conflict('Food from this donation has already been handed over; it cannot be cancelled.', 'DONATION_ALREADY_COLLECTED');
      assertTransition('donation', d.status, 'CANCELLED');
      const active = await many<{ id: string }>(tx, `SELECT id FROM donation_allocations WHERE donation_id = $1 AND status IN ('RESERVED','PICKUP_ASSIGNED')`, [id]);
      for (const a of active) {
        notices.push(
          ...(await this.allocations.releaseAllocation(tx, a.id, { status: 'CANCELLED', party: auth.role === 'ADMIN' ? 'ADMIN' : 'DONOR', reason: `donation cancelled: ${reason}` }, actor)),
        );
      }
      const pending = await many<{ id: string; ngo_owner: string }>(
        tx,
        `UPDATE donation_requests r SET status = 'CANCELLED', decision_reason = 'donation cancelled'
           FROM ngos n WHERE n.id = r.ngo_id AND r.donation_id = $1 AND r.status = 'PENDING' RETURNING r.id, n.owner_user_id AS ngo_owner`,
        [id],
      );
      for (const p of pending) {
        notices.push(
          await this.notifications.create(tx, {
            userId: p.ngo_owner,
            type: 'DONATION_CANCELLED',
            title: 'Donation cancelled',
            body:
              auth.role === 'ADMIN'
                ? `A FoodBridge administrator cancelled "${d.food_name}" from ${d.donor_name} before your request was approved.`
                : `${d.donor_name} cancelled "${d.food_name}" before your request was approved.`,
            linkPath: `/ngo/requests`,
            dedupeKey: `donation-cancelled:${id}:${p.id}`,
          }),
        );
      }
      const current = await one<{ status: string }>(tx, 'SELECT status FROM donations WHERE id = $1', [id]);
      await tx.query('UPDATE donations SET status = $2, cancelled_reason = $3, version = version + 1 WHERE id = $1', [id, 'CANCELLED', reason]);
      await insertDonationHistory(tx, id, current?.status ?? d.status, 'CANCELLED', auth.userId, reason);
      await recordAudit(tx, actor, { action: 'donation.cancelled', entityType: 'donation', entityId: id, changes: { reason } });
    });
    this.notifications.publish(notices);
    return this.get(auth, id);
  }

  // -------------------------------------------------------------------------
  // Workflow A: NGO requests a listed donation; donor approves or rejects
  // -------------------------------------------------------------------------

  async createRequest(auth: AuthContext, donationId: string, input: { quantity: number; message?: string | undefined }, actor: Actor) {
    if (!auth.ngoId) throw forbidden();
    const ngo = await findNgoById(this.db, auth.ngoId);
    if (!ngo) throw notFound('NGO');
    const d = await findDonation(this.db, donationId);
    if (!d || d.origin !== 'DIRECT_LISTING' || d.status === 'DRAFT') throw notFound('Donation');
    if (availableQuantity(d) <= 0) throw conflict('This donation is no longer available.', 'DONATION_NOT_AVAILABLE');
    if (input.quantity > availableQuantity(d)) {
      throw conflict(`Only ${availableQuantity(d)} ${d.unit.toLowerCase()} are available.`, 'INSUFFICIENT_QUANTITY', { available: availableQuantity(d) });
    }
    if ((d.dietary_type === 'VEG' && !ngo.accepts_veg) || (d.dietary_type === 'NON_VEG' && !ngo.accepts_non_veg)) {
      throw unprocessable('Your NGO profile does not accept this dietary type.', 'DIETARY_INCOMPATIBLE');
    }
    const accepts = await one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM ngo_food_preferences WHERE ngo_id = $1 AND category_id = $2', [auth.ngoId, d.category_id]);
    if ((accepts?.n ?? 0) === 0) throw unprocessable('Your NGO profile does not accept this food category. Update your food preferences first.', 'CATEGORY_NOT_ACCEPTED');

    const { requestId, notice } = await this.db.transaction(async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO donation_requests (donation_id, ngo_id, requested_by, requested_quantity, message) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [donationId, auth.ngoId, auth.userId, input.quantity, input.message ?? null],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') throw conflict('Your NGO already has an active request for this donation.', 'DUPLICATE_REQUEST');
        throw err;
      });
      if (!row) throw new Error('request insert failed');
      await tx.query(
        `UPDATE match_recommendations SET response = 'REQUESTED', responded_at = now() WHERE donation_id = $1 AND candidate_ngo_id = $2 AND response = 'NONE'`,
        [donationId, auth.ngoId],
      );
      await recordAudit(tx, actor, { action: 'donation_request.created', entityType: 'donation_request', entityId: row.id, metadata: { donationId, quantity: input.quantity } });
      const n = await this.notifications.create(tx, {
        userId: d.donor_owner_user_id,
        type: 'REQUEST_RECEIVED',
        title: 'New request for your donation',
        body: `${ngo.organization_name} requested ${input.quantity} ${d.unit.toLowerCase()} of ${d.food_name}.`,
        linkPath: `/donor/donations/${donationId}`,
        priority: 'HIGH',
        dedupeKey: `request-received:${row.id}`,
        data: { donationId, requestId: row.id },
        email: true,
      });
      return { requestId: row.id, notice: n };
    });
    this.notifications.publish([notice]);
    const estimate = await this.fees.estimate(d.unit, input.quantity);
    return { id: requestId, donationId, quantity: input.quantity, status: 'PENDING', feeEstimate: estimate };
  }

  async listRequests(auth: AuthContext, f: { status?: string | undefined; donationId?: string | undefined; page: number; pageSize: number }) {
    const where: string[] = [];
    const v: unknown[] = [];
    if (auth.role === 'DONOR') where.push(`d.donor_id = $${v.push(auth.donorId)}`);
    else if (auth.role === 'NGO') where.push(`r.ngo_id = $${v.push(scopedNgoId(auth))}`);
    if (f.status) where.push(`r.status = $${v.push(f.status)}`);
    if (f.donationId) where.push(`r.donation_id = $${v.push(f.donationId)}`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT r.id, r.donation_id, d.food_name, d.unit, d.dietary_type, d.pickup_deadline, d.status AS donation_status,
              d.quantity - d.reserved_quantity AS donation_available, dn.business_name AS donor_name,
              r.ngo_id, n.organization_name AS ngo_name, n.beneficiaries_count, r.requested_quantity, r.approved_quantity,
              r.message, r.status, r.created_at, r.decided_at, r.decision_reason
         FROM donation_requests r JOIN donations d ON d.id = r.donation_id JOIN donors dn ON dn.id = d.donor_id JOIN ngos n ON n.id = r.ngo_id
         ${w} ORDER BY r.created_at DESC LIMIT $${v.length + 1} OFFSET $${v.length + 2}`,
      [...v, f.pageSize, (f.page - 1) * f.pageSize],
    );
    const total = await one<{ n: number }>(this.db, `SELECT count(*) AS n FROM donation_requests r JOIN donations d ON d.id = r.donation_id ${w}`, v);
    return {
      items: rows.map((r) => ({
        id: r.id,
        donation: {
          id: r.donation_id,
          foodName: r.food_name,
          unit: r.unit,
          dietaryType: r.dietary_type,
          pickupDeadline: r.pickup_deadline,
          status: r.donation_status,
          availableQuantity: r.donation_available,
          donorName: r.donor_name,
        },
        ngo: { id: r.ngo_id, name: r.ngo_name, beneficiariesCount: r.beneficiaries_count },
        requestedQuantity: r.requested_quantity,
        approvedQuantity: r.approved_quantity,
        message: r.message,
        status: r.status,
        createdAt: r.created_at,
        decidedAt: r.decided_at,
        decisionReason: r.decision_reason,
      })),
      total: total?.n ?? 0,
    };
  }

  /**
   * Donor approves a request: reserves the quantity atomically and creates the
   * allocation in one transaction. A concurrent approval that would exceed the
   * available quantity fails with 409 and changes nothing.
   */
  async approveRequest(auth: AuthContext, requestId: string, quantity: number | undefined, actor: Actor) {
    const minLead = await this.settings.get('matching.min_lead_minutes');
    const result = await this.db.transaction((tx) => this.approveRequestInTx(tx, auth, requestId, quantity, minLead, actor));
    this.notifications.publish([result.notice]);
    return { requestId, allocationId: result.allocationId, approvedQuantity: result.approved };
  }

  /** Shared by single approvals and optimizer-recommended batch approvals. */
  async approveRequestInTx(tx: Parameters<Parameters<Database['transaction']>[0]>[0], auth: AuthContext, requestId: string, quantity: number | undefined, minLead: number, actor: Actor) {
    const r = await one<{ id: string; donation_id: string; ngo_id: string; requested_quantity: number; status: string; ngo_owner: string; ngo_name: string }>(
      tx,
      `SELECT r.id, r.donation_id, r.ngo_id, r.requested_quantity, r.status, n.owner_user_id AS ngo_owner, n.organization_name AS ngo_name
         FROM donation_requests r JOIN ngos n ON n.id = r.ngo_id WHERE r.id = $1`,
      [requestId],
    );
    if (!r) throw notFound('Request');
    const d = await findDonation(tx, r.donation_id, true);
    if (!d || d.donor_id !== auth.donorId) throw notFound('Request');
    await tx.query('SELECT 1 FROM donation_requests WHERE id = $1 FOR UPDATE', [requestId]);
    const locked = await one<{ status: string }>(tx, 'SELECT status FROM donation_requests WHERE id = $1', [requestId]);
    if (locked?.status !== 'PENDING') throw conflict(`This request is already ${locked?.status?.toLowerCase()}.`, 'REQUEST_NOT_PENDING');
    const approved = quantity ?? r.requested_quantity;
    if (approved > r.requested_quantity) throw unprocessable('You cannot approve more than was requested.', 'APPROVAL_EXCEEDS_REQUEST');
    await this.allocations.reserveDonationQuantity(tx, d.id, approved, minLead, auth.userId);
    const allocationId = await this.allocations.createAllocation(tx, {
      donationId: d.id,
      ngoId: r.ngo_id,
      quantity: approved,
      source: 'DONATION_REQUEST',
      donationRequestId: requestId,
    });
    await tx.query(
      `UPDATE donation_requests SET status = 'APPROVED', approved_quantity = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
      [requestId, approved, auth.userId],
    );
    await recordAudit(tx, actor, {
      action: 'donation_request.approved',
      entityType: 'donation_request',
      entityId: requestId,
      changes: { approvedQuantity: approved, allocationId },
    });
    const notice = await this.notifications.create(tx, {
      userId: r.ngo_owner,
      type: 'REQUEST_APPROVED',
      title: 'Your request was approved',
      body: `${d.donor_name} approved ${approved} ${d.unit.toLowerCase()} of ${d.food_name}. Pickup by ${formatDateTime(d.pickup_deadline)}. Assign a representative to collect it.`,
      linkPath: `/ngo/collections`,
      priority: 'HIGH',
      dedupeKey: `request-approved:${requestId}`,
      data: { donationId: d.id, allocationId },
      email: true,
    });
    return { allocationId, approved, notice };
  }

  /**
   * Approves several requests on one donation in a single transaction (used to
   * apply an optimiser recommendation the donor reviewed). All-or-nothing.
   */
  async approveBatch(auth: AuthContext, donationId: string, items: { requestId: string; quantity: number }[], actor: Actor) {
    const minLead = await this.settings.get('matching.min_lead_minutes');
    const results = await this.db.transaction(async (tx) => {
      const out: { requestId: string; allocationId: string; approvedQuantity: number; notice: NotificationRow | null }[] = [];
      for (const item of items) {
        const owner = await one<{ donation_id: string }>(tx, 'SELECT donation_id FROM donation_requests WHERE id = $1', [item.requestId]);
        if (owner?.donation_id !== donationId) throw unprocessable('Every request must belong to this donation.', 'REQUEST_DONATION_MISMATCH');
        const r = await this.approveRequestInTx(tx, auth, item.requestId, item.quantity, minLead, actor);
        out.push({ requestId: item.requestId, allocationId: r.allocationId, approvedQuantity: r.approved, notice: r.notice });
      }
      return out;
    });
    this.notifications.publish(results.map((r) => r.notice));
    return results.map(({ notice: _n, ...rest }) => rest);
  }

  async rejectRequest(auth: AuthContext, requestId: string, reason: string | undefined, actor: Actor) {
    const notice = await this.db.transaction(async (tx) => {
      const r = await one<{ status: string; donor_id: string; ngo_owner: string; food_name: string; donation_id: string }>(
        tx,
        `SELECT r.status, d.donor_id, n.owner_user_id AS ngo_owner, d.food_name, d.id AS donation_id
           FROM donation_requests r JOIN donations d ON d.id = r.donation_id JOIN ngos n ON n.id = r.ngo_id WHERE r.id = $1 FOR UPDATE OF r`,
        [requestId],
      );
      if (!r || r.donor_id !== auth.donorId) throw notFound('Request');
      if (r.status !== 'PENDING') throw conflict(`This request is already ${r.status.toLowerCase()}.`, 'REQUEST_NOT_PENDING');
      await tx.query(`UPDATE donation_requests SET status = 'REJECTED', decided_by = $2, decided_at = now(), decision_reason = $3 WHERE id = $1`, [
        requestId,
        auth.userId,
        reason ?? null,
      ]);
      await recordAudit(tx, actor, { action: 'donation_request.rejected', entityType: 'donation_request', entityId: requestId, changes: { reason } });
      return this.notifications.create(tx, {
        userId: r.ngo_owner,
        type: 'REQUEST_REJECTED',
        title: 'Request not approved',
        body: `Your request for ${r.food_name} was not approved${reason ? `: ${reason}` : '.'}`,
        linkPath: '/ngo/requests',
        dedupeKey: `request-rejected:${requestId}`,
      });
    });
    this.notifications.publish([notice]);
  }

  async withdrawRequest(auth: AuthContext, requestId: string, actor: Actor) {
    await this.db.transaction(async (tx) => {
      const r = await one<{ status: string; ngo_id: string }>(tx, 'SELECT status, ngo_id FROM donation_requests WHERE id = $1 FOR UPDATE', [requestId]);
      if (!r || r.ngo_id !== auth.ngoId) throw notFound('Request');
      if (r.status !== 'PENDING') throw conflict('Only pending requests can be withdrawn. Cancel the reservation instead.', 'REQUEST_NOT_PENDING');
      await tx.query(`UPDATE donation_requests SET status = 'WITHDRAWN' WHERE id = $1`, [requestId]);
      await recordAudit(tx, actor, { action: 'donation_request.withdrawn', entityType: 'donation_request', entityId: requestId });
    });
  }
}
