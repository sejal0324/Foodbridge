import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import {
  findDonorById,
  findNgoById,
  listDonorAvailability,
  listDonorCategoryCodes,
  listNgoCategoryCodes,
  pointSql,
  type DonorRow,
  type NgoRow,
} from '../repositories/organisation.repository.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import type { LatLng } from '../validators/common.js';
import { recordAudit } from './audit.service.js';
import type { NotificationService } from './notification.service.js';

export function toDonorDto(d: DonorRow) {
  return {
    id: d.id,
    businessName: d.business_name,
    businessType: d.business_type,
    licenseNumber: d.license_number,
    contactEmail: d.contact_email,
    contactPhone: d.contact_phone,
    addressLine: d.address_line,
    city: d.city,
    state: d.state,
    postalCode: d.postal_code,
    location: d.lat === null || d.lng === null ? null : { lat: d.lat, lng: d.lng },
    timezone: d.timezone,
    verificationStatus: d.verification_status,
    verificationNotes: d.verification_notes,
    verifiedAt: d.verified_at,
    acceptsAssistanceRequests: d.accepts_assistance_requests,
    pausedUntil: d.paused_until,
    publicRecognitionConsent: d.public_recognition_consent,
    createdAt: d.created_at,
  };
}

export function toNgoDto(n: NgoRow) {
  return {
    id: n.id,
    organizationName: n.organization_name,
    registrationNumber: n.registration_number,
    contactEmail: n.contact_email,
    contactPhone: n.contact_phone,
    addressLine: n.address_line,
    city: n.city,
    state: n.state,
    postalCode: n.postal_code,
    location: n.lat === null || n.lng === null ? null : { lat: n.lat, lng: n.lng },
    timezone: n.timezone,
    acceptsVeg: n.accepts_veg,
    acceptsNonVeg: n.accepts_non_veg,
    maxDailyCapacity: n.max_daily_capacity,
    collectionRadiusKm: n.collection_radius_km,
    beneficiariesCount: n.beneficiaries_count,
    beneficiaryDescription: n.beneficiary_description,
    hasRefrigeration: n.has_refrigeration,
    defaultVehicleCapacity: n.default_vehicle_capacity,
    verificationStatus: n.verification_status,
    verificationNotes: n.verification_notes,
    verifiedAt: n.verified_at,
    createdAt: n.created_at,
  };
}

export interface DonorUpdate {
  businessName?: string | undefined;
  businessType?: string | undefined;
  licenseNumber?: string | undefined;
  contactPhone?: string | undefined;
  addressLine?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  location?: LatLng | undefined;
  acceptsAssistanceRequests?: boolean | undefined;
  pausedUntil?: Date | null | undefined;
  publicRecognitionConsent?: boolean | undefined;
}

export interface NgoUpdate {
  organizationName?: string | undefined;
  registrationNumber?: string | undefined;
  contactPhone?: string | undefined;
  addressLine?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  location?: LatLng | undefined;
  acceptsVeg?: boolean | undefined;
  acceptsNonVeg?: boolean | undefined;
  maxDailyCapacity?: number | undefined;
  collectionRadiusKm?: number | undefined;
  beneficiariesCount?: number | undefined;
  beneficiaryDescription?: string | undefined;
  hasRefrigeration?: boolean | undefined;
  defaultVehicleCapacity?: number | null | undefined;
}

const DONOR_FIELDS: Record<keyof Omit<DonorUpdate, 'location'>, string> = {
  businessName: 'business_name',
  businessType: 'business_type',
  licenseNumber: 'license_number',
  contactPhone: 'contact_phone',
  addressLine: 'address_line',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  acceptsAssistanceRequests: 'accepts_assistance_requests',
  pausedUntil: 'paused_until',
  publicRecognitionConsent: 'public_recognition_consent',
};

const NGO_FIELDS: Record<keyof Omit<NgoUpdate, 'location'>, string> = {
  organizationName: 'organization_name',
  registrationNumber: 'registration_number',
  contactPhone: 'contact_phone',
  addressLine: 'address_line',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  acceptsVeg: 'accepts_veg',
  acceptsNonVeg: 'accepts_non_veg',
  maxDailyCapacity: 'max_daily_capacity',
  collectionRadiusKm: 'collection_radius_km',
  beneficiariesCount: 'beneficiaries_count',
  beneficiaryDescription: 'beneficiary_description',
  hasRefrigeration: 'has_refrigeration',
  defaultVehicleCapacity: 'default_vehicle_capacity',
};

/** Builds a whitelisted SET clause (column names come only from the maps above, never from input). */
function buildSet(update: Record<string, unknown>, fields: Record<string, string>, startIndex: number) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(fields)) {
    if (update[key] !== undefined) {
      values.push(update[key]);
      sets.push(`${column} = $${startIndex + values.length - 1}`);
    }
  }
  const loc = update.location as LatLng | undefined;
  if (loc) {
    values.push(loc.lng, loc.lat);
    sets.push(`location = ${pointSql(`$${startIndex + values.length - 2}`, `$${startIndex + values.length - 1}`)}`);
  }
  return { sets, values };
}

export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationService,
  ) {}

  /** Current user summary used by the frontend to route and render. */
  async me(auth: AuthContext) {
    const user = await one<{ phone: string | null; account_status: string; created_at: Date }>(
      this.db,
      'SELECT phone, account_status, created_at FROM users WHERE id = $1',
      [auth.userId],
    );
    let organization: { type: 'DONOR' | 'NGO'; id: string; name: string; verificationStatus: string } | null = null;
    if (auth.donorId) {
      const d = await findDonorById(this.db, auth.donorId);
      if (d) organization = { type: 'DONOR', id: d.id, name: d.business_name, verificationStatus: d.verification_status };
    } else if (auth.ngoId) {
      const n = await findNgoById(this.db, auth.ngoId);
      if (n) organization = { type: 'NGO', id: n.id, name: n.organization_name, verificationStatus: n.verification_status };
    }
    let representative: { id: string; ngoId: string; ngoName: string; status: string } | null = null;
    if (auth.representativeId && auth.representativeNgoId) {
      const r = await one<{ status: string; organization_name: string }>(
        this.db,
        `SELECT r.status, n.organization_name FROM ngo_representatives r JOIN ngos n ON n.id = r.ngo_id WHERE r.id = $1`,
        [auth.representativeId],
      );
      if (r) representative = { id: auth.representativeId, ngoId: auth.representativeNgoId, ngoName: r.organization_name, status: r.status };
    }
    return {
      id: auth.userId,
      email: auth.email,
      fullName: auth.fullName,
      phone: user?.phone ?? null,
      role: auth.role,
      accountStatus: user?.account_status ?? 'ACTIVE',
      adminLevel: auth.adminLevel,
      organization,
      representative,
      createdAt: user?.created_at,
    };
  }

  async getDonorProfile(donorId: string) {
    const d = await findDonorById(this.db, donorId);
    if (!d) throw notFound('Donor');
    const [categories, availability] = await Promise.all([
      listDonorCategoryCodes(this.db, donorId),
      listDonorAvailability(this.db, donorId),
    ]);
    return {
      ...toDonorDto(d),
      categories,
      availability: availability.map((a) => ({ isoDayOfWeek: a.iso_day_of_week, opensAt: a.opens_at, closesAt: a.closes_at })),
    };
  }

  async updateDonorProfile(auth: AuthContext, update: DonorUpdate, actor: Actor) {
    if (!auth.donorId) throw forbidden();
    const { sets, values } = buildSet(update as Record<string, unknown>, DONOR_FIELDS, 2);
    if (sets.length === 0) throw badRequest('No changes supplied.');
    const resubmitted = await this.db.transaction(async (tx) => {
      const before = await one<{ verification_status: string }>(tx, 'SELECT verification_status FROM donors WHERE id = $1 FOR UPDATE', [auth.donorId]);
      // A rejected organisation that edits its profile goes back into the review queue.
      const resubmit = before?.verification_status === 'REJECTED';
      if (resubmit) sets.push(`verification_status = 'PENDING'`);
      await tx.query(`UPDATE donors SET ${sets.join(', ')} WHERE id = $1`, [auth.donorId, ...values]);
      await recordAudit(tx, actor, { action: 'donor.profile_updated', entityType: 'donor', entityId: auth.donorId, changes: { ...update } });
      return resubmit
        ? this.notifications.notifyAdmins(tx, {
            type: 'VERIFICATION_PENDING',
            title: 'Donor resubmitted for verification',
            body: 'A previously rejected donor updated its profile and is waiting for review.',
            linkPath: '/admin/verifications',
            dedupeKey: `verification-resubmitted:${auth.donorId}:${Date.now()}`,
          })
        : [];
    });
    this.notifications.publish(resubmitted);
    return this.getDonorProfile(auth.donorId);
  }

  async setDonorAvailability(auth: AuthContext, slots: { isoDayOfWeek: number; opensAt: string; closesAt: string }[], actor: Actor) {
    if (!auth.donorId) throw forbidden();
    await this.db.transaction(async (tx) => {
      await tx.query('DELETE FROM donor_availability WHERE donor_id = $1', [auth.donorId]);
      for (const s of slots) {
        await tx.query('INSERT INTO donor_availability (donor_id, iso_day_of_week, opens_at, closes_at) VALUES ($1, $2, $3, $4)', [
          auth.donorId,
          s.isoDayOfWeek,
          s.opensAt,
          s.closesAt,
        ]);
      }
      await recordAudit(tx, actor, { action: 'donor.availability_updated', entityType: 'donor', entityId: auth.donorId, changes: { slots } });
    });
    return this.getDonorProfile(auth.donorId);
  }

  async setDonorCategories(auth: AuthContext, categoryIds: string[], actor: Actor) {
    if (!auth.donorId) throw forbidden();
    await this.replaceCategories('donor_food_categories', 'donor_id', auth.donorId, categoryIds, actor, 'donor.categories_updated');
    return this.getDonorProfile(auth.donorId);
  }

  async getNgoProfile(ngoId: string) {
    const n = await findNgoById(this.db, ngoId);
    if (!n) throw notFound('NGO');
    const categories = await listNgoCategoryCodes(this.db, ngoId);
    return { ...toNgoDto(n), foodPreferences: categories };
  }

  async updateNgoProfile(auth: AuthContext, update: NgoUpdate, actor: Actor) {
    if (!auth.ngoId) throw forbidden();
    const { sets, values } = buildSet(update as Record<string, unknown>, NGO_FIELDS, 2);
    if (sets.length === 0) throw badRequest('No changes supplied.');
    const notices = await this.db.transaction(async (tx) => {
      const before = await one<{ verification_status: string }>(tx, 'SELECT verification_status FROM ngos WHERE id = $1 FOR UPDATE', [auth.ngoId]);
      const resubmit = before?.verification_status === 'REJECTED';
      if (resubmit) sets.push(`verification_status = 'PENDING'`);
      await tx.query(`UPDATE ngos SET ${sets.join(', ')} WHERE id = $1`, [auth.ngoId, ...values]);
      await recordAudit(tx, actor, { action: 'ngo.profile_updated', entityType: 'ngo', entityId: auth.ngoId, changes: { ...update } });
      return resubmit
        ? this.notifications.notifyAdmins(tx, {
            type: 'VERIFICATION_PENDING',
            title: 'NGO resubmitted for verification',
            body: 'A previously rejected NGO updated its profile and is waiting for review.',
            linkPath: '/admin/verifications',
            dedupeKey: `verification-resubmitted:${auth.ngoId}:${Date.now()}`,
          })
        : [];
    });
    this.notifications.publish(notices);
    return this.getNgoProfile(auth.ngoId);
  }

  async setNgoFoodPreferences(auth: AuthContext, categoryIds: string[], actor: Actor) {
    if (!auth.ngoId) throw forbidden();
    await this.replaceCategories('ngo_food_preferences', 'ngo_id', auth.ngoId, categoryIds, actor, 'ngo.food_preferences_updated');
    return this.getNgoProfile(auth.ngoId);
  }

  private async replaceCategories(
    table: 'donor_food_categories' | 'ngo_food_preferences',
    ownerColumn: 'donor_id' | 'ngo_id',
    ownerId: string,
    categoryIds: string[],
    actor: Actor,
    action: string,
  ) {
    const unique = [...new Set(categoryIds)];
    await this.db.transaction(async (tx) => {
      const found = await many<{ id: string }>(tx, 'SELECT id FROM food_categories WHERE id = ANY($1::uuid[]) AND is_active', [unique]);
      if (found.length !== unique.length) throw badRequest('One or more food categories are unknown or inactive.', undefined, 'UNKNOWN_CATEGORY');
      await tx.query(`DELETE FROM ${table} WHERE ${ownerColumn} = $1`, [ownerId]);
      for (const id of unique) await tx.query(`INSERT INTO ${table} (${ownerColumn}, category_id) VALUES ($1, $2)`, [ownerId, id]);
      await recordAudit(tx, actor, { action, entityType: ownerColumn === 'donor_id' ? 'donor' : 'ngo', entityId: ownerId, changes: { categoryIds: unique } });
    });
  }

  async listFoodCategories() {
    const rows = await many<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      max_hours_after_preparation: number | null;
      requires_refrigeration: boolean;
    }>(
      this.db,
      `SELECT id, code, name, description, max_hours_after_preparation, requires_refrigeration
         FROM food_categories WHERE is_active ORDER BY sort_order, name`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      reviewFlagHoursAfterPreparation: r.max_hours_after_preparation,
      requiresRefrigeration: r.requires_refrigeration,
    }));
  }
}
