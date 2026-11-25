import type { Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import type { LatLng } from '../validators/common.js';

/** SQL fragment turning a geography column into lat/lng columns. */
export const latLngColumns = (column: string, prefix = '') =>
  `ST_Y(${column}::geometry) AS ${prefix}lat, ST_X(${column}::geometry) AS ${prefix}lng`;

/** SQL expression for a geography point from $lng/$lat parameters. */
export const pointSql = (lngParam: string, latParam: string) =>
  `ST_SetSRID(ST_MakePoint(${lngParam}, ${latParam}), 4326)::geography`;

export interface AddressInput {
  addressLine?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  location?: LatLng | undefined;
}

export interface DonorRow {
  id: string;
  owner_user_id: string;
  business_name: string;
  business_type: string;
  license_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  verification_status: string;
  verification_notes: string | null;
  verified_at: Date | null;
  accepts_assistance_requests: boolean;
  paused_until: Date | null;
  public_recognition_consent: boolean;
  created_at: Date;
}

const DONOR_COLUMNS = `d.id, d.owner_user_id, d.business_name, d.business_type, d.license_number, d.contact_email, d.contact_phone,
  d.address_line, d.city, d.state, d.postal_code, ${latLngColumns('d.location')}, d.timezone, d.verification_status,
  d.verification_notes, d.verified_at, d.accepts_assistance_requests, d.paused_until, d.public_recognition_consent, d.created_at`;

export async function insertDonor(
  q: Queryable,
  d: { ownerUserId: string; businessName: string; businessType: string; licenseNumber?: string | undefined; contactEmail?: string; contactPhone?: string | undefined } & AddressInput,
): Promise<{ id: string }> {
  const row = await one<{ id: string }>(
    q,
    `INSERT INTO donors (owner_user_id, business_name, business_type, license_number, contact_email, contact_phone,
                         address_line, city, state, postal_code, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CASE WHEN $11::float8 IS NULL THEN NULL ELSE ${pointSql('$12', '$11')} END)
     RETURNING id`,
    [
      d.ownerUserId,
      d.businessName,
      d.businessType,
      d.licenseNumber ?? null,
      d.contactEmail ?? null,
      d.contactPhone ?? null,
      d.addressLine ?? null,
      d.city ?? null,
      d.state ?? null,
      d.postalCode ?? null,
      d.location?.lat ?? null,
      d.location?.lng ?? null,
    ],
  );
  if (!row) throw new Error('donor insert failed');
  return row;
}

export function findDonorById(q: Queryable, id: string): Promise<DonorRow | undefined> {
  return one<DonorRow>(q, `SELECT ${DONOR_COLUMNS} FROM donors d WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
}

export interface NgoRow {
  id: string;
  owner_user_id: string;
  organization_name: string;
  registration_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  accepts_veg: boolean;
  accepts_non_veg: boolean;
  max_daily_capacity: number;
  collection_radius_km: number;
  beneficiaries_count: number;
  beneficiary_description: string | null;
  has_refrigeration: boolean;
  default_vehicle_capacity: number | null;
  verification_status: string;
  verification_notes: string | null;
  verified_at: Date | null;
  created_at: Date;
}

const NGO_COLUMNS = `n.id, n.owner_user_id, n.organization_name, n.registration_number, n.contact_email, n.contact_phone,
  n.address_line, n.city, n.state, n.postal_code, ${latLngColumns('n.location')}, n.timezone, n.accepts_veg, n.accepts_non_veg,
  n.max_daily_capacity, n.collection_radius_km, n.beneficiaries_count, n.beneficiary_description, n.has_refrigeration,
  n.default_vehicle_capacity, n.verification_status, n.verification_notes, n.verified_at, n.created_at`;

export async function insertNgo(
  q: Queryable,
  n: { ownerUserId: string; organizationName: string; registrationNumber?: string | undefined; contactEmail?: string; contactPhone?: string | undefined } & AddressInput,
): Promise<{ id: string }> {
  const row = await one<{ id: string }>(
    q,
    `INSERT INTO ngos (owner_user_id, organization_name, registration_number, contact_email, contact_phone,
                       address_line, city, state, postal_code, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $10::float8 IS NULL THEN NULL ELSE ${pointSql('$11', '$10')} END)
     RETURNING id`,
    [
      n.ownerUserId,
      n.organizationName,
      n.registrationNumber ?? null,
      n.contactEmail ?? null,
      n.contactPhone ?? null,
      n.addressLine ?? null,
      n.city ?? null,
      n.state ?? null,
      n.postalCode ?? null,
      n.location?.lat ?? null,
      n.location?.lng ?? null,
    ],
  );
  if (!row) throw new Error('ngo insert failed');
  return row;
}

export function findNgoById(q: Queryable, id: string): Promise<NgoRow | undefined> {
  return one<NgoRow>(q, `SELECT ${NGO_COLUMNS} FROM ngos n WHERE n.id = $1 AND n.deleted_at IS NULL`, [id]);
}

export function listDonorCategoryCodes(q: Queryable, donorId: string): Promise<{ id: string; code: string }[]> {
  return many(q, `SELECT c.id, c.code FROM donor_food_categories x JOIN food_categories c ON c.id = x.category_id WHERE x.donor_id = $1 ORDER BY c.sort_order`, [donorId]);
}

export function listNgoCategoryCodes(q: Queryable, ngoId: string): Promise<{ id: string; code: string }[]> {
  return many(q, `SELECT c.id, c.code FROM ngo_food_preferences x JOIN food_categories c ON c.id = x.category_id WHERE x.ngo_id = $1 ORDER BY c.sort_order`, [ngoId]);
}

export function listDonorAvailability(
  q: Queryable,
  donorId: string,
): Promise<{ iso_day_of_week: number; opens_at: string; closes_at: string }[]> {
  return many(
    q,
    `SELECT iso_day_of_week, to_char(opens_at, 'HH24:MI') AS opens_at, to_char(closes_at, 'HH24:MI') AS closes_at
       FROM donor_availability WHERE donor_id = $1 ORDER BY iso_day_of_week, opens_at`,
    [donorId],
  );
}
