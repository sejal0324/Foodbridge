import type { Queryable } from '../db/database.js';
import { one } from '../db/database.js';
import { latLngColumns, pointSql } from './organisation.repository.js';

export interface DonationRow {
  id: string;
  donor_id: string;
  donor_name: string;
  donor_owner_user_id: string;
  origin: 'DIRECT_LISTING' | 'ASSISTANCE_OFFER';
  food_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
  category_requires_refrigeration: boolean;
  category_review_hours: number | null;
  dietary_type: 'VEG' | 'NON_VEG';
  quantity: number;
  unit: 'MEALS' | 'PACKETS' | 'BOXES';
  reserved_quantity: number;
  expired_quantity: number;
  prepared_at: Date;
  best_before: Date | null;
  storage_type: string;
  storage_notes: string | null;
  pickup_available_from: Date;
  pickup_deadline: Date;
  lat: number;
  lng: number;
  address: string;
  description: string | null;
  safety_confirmed: boolean;
  safety_confirmed_at: Date | null;
  status: string;
  cancelled_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  distance_m?: number | null;
}

export const DONATION_SELECT = `
  SELECT d.id, d.donor_id, dn.business_name AS donor_name, dn.owner_user_id AS donor_owner_user_id, d.origin, d.food_name,
         d.category_id, c.code AS category_code, c.name AS category_name, c.requires_refrigeration AS category_requires_refrigeration,
         c.max_hours_after_preparation AS category_review_hours, d.dietary_type, d.quantity, d.unit, d.reserved_quantity,
         d.expired_quantity, d.prepared_at, d.best_before, d.storage_type, d.storage_notes, d.pickup_available_from,
         d.pickup_deadline, ${latLngColumns('d.location')}, d.address, d.description, d.safety_confirmed, d.safety_confirmed_at,
         d.status, d.cancelled_reason, d.version, d.created_at, d.updated_at
    FROM donations d
    JOIN donors dn ON dn.id = d.donor_id
    JOIN food_categories c ON c.id = d.category_id`;

const OPEN_STATUSES = new Set(['AVAILABLE', 'PARTIALLY_RESERVED']);

export function availableQuantity(d: Pick<DonationRow, 'status' | 'quantity' | 'reserved_quantity' | 'pickup_deadline'>): number {
  if (!OPEN_STATUSES.has(d.status) || d.pickup_deadline <= new Date()) return 0;
  return d.quantity - d.reserved_quantity;
}

export function toDonationDto(d: DonationRow) {
  return {
    id: d.id,
    donor: { id: d.donor_id, name: d.donor_name },
    origin: d.origin,
    foodName: d.food_name,
    category: { id: d.category_id, code: d.category_code, name: d.category_name },
    dietaryType: d.dietary_type,
    quantity: d.quantity,
    unit: d.unit,
    reservedQuantity: d.reserved_quantity,
    availableQuantity: availableQuantity(d),
    expiredQuantity: d.expired_quantity,
    preparedAt: d.prepared_at,
    bestBefore: d.best_before,
    storageType: d.storage_type,
    storageNotes: d.storage_notes,
    pickupAvailableFrom: d.pickup_available_from,
    pickupDeadline: d.pickup_deadline,
    location: { lat: d.lat, lng: d.lng },
    address: d.address,
    description: d.description,
    safetyConfirmed: d.safety_confirmed,
    status: d.status,
    cancelledReason: d.cancelled_reason,
    version: d.version,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    ...(d.distance_m !== undefined && d.distance_m !== null
      ? { distanceKm: Math.round(d.distance_m / 100) / 10, distanceSource: 'STRAIGHT_LINE_ESTIMATE' as const }
      : {}),
  };
}

export async function findDonation(q: Queryable, id: string, forUpdate = false): Promise<DonationRow | undefined> {
  if (forUpdate) await q.query('SELECT 1 FROM donations WHERE id = $1 FOR UPDATE', [id]);
  return one<DonationRow>(q, `${DONATION_SELECT} WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
}

export interface NewDonation {
  donorId: string;
  origin: 'DIRECT_LISTING' | 'ASSISTANCE_OFFER';
  foodName: string;
  categoryId: string;
  dietaryType: string;
  quantity: number;
  unit: string;
  reservedQuantity?: number;
  preparedAt: Date;
  bestBefore?: Date | undefined;
  storageType: string;
  storageNotes?: string | undefined;
  pickupAvailableFrom: Date;
  pickupDeadline: Date;
  location: { lat: number; lng: number };
  address: string;
  description?: string | undefined;
  safetyConfirmed: boolean;
  status: string;
}

export async function insertDonation(q: Queryable, d: NewDonation): Promise<string> {
  const row = await one<{ id: string }>(
    q,
    `INSERT INTO donations (donor_id, origin, food_name, category_id, dietary_type, quantity, unit, reserved_quantity, prepared_at,
                            best_before, storage_type, storage_notes, pickup_available_from, pickup_deadline, location, address,
                            description, safety_confirmed, safety_confirmed_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ${pointSql('$15', '$16')}, $17, $18, $19,
             CASE WHEN $19 THEN now() ELSE NULL END, $20)
     RETURNING id`,
    [
      d.donorId,
      d.origin,
      d.foodName,
      d.categoryId,
      d.dietaryType,
      d.quantity,
      d.unit,
      d.reservedQuantity ?? 0,
      d.preparedAt,
      d.bestBefore ?? null,
      d.storageType,
      d.storageNotes ?? null,
      d.pickupAvailableFrom,
      d.pickupDeadline,
      d.location.lng,
      d.location.lat,
      d.address,
      d.description ?? null,
      d.safetyConfirmed,
      d.status,
    ],
  );
  if (!row) throw new Error('donation insert failed');
  return row.id;
}

export async function insertDonationHistory(
  q: Queryable,
  donationId: string,
  from: string | null,
  to: string,
  actorUserId: string | null,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `INSERT INTO donation_status_history (donation_id, from_status, to_status, changed_by, reason, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
    [donationId, from, to, actorUserId, reason ?? null, metadata ? JSON.stringify(metadata) : null],
  );
}
