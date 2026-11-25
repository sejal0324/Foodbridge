import type { LatLng } from '@/types';

/** The 28 states of India. */
export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

/** The 8 union territories of India. */
export const INDIAN_UNION_TERRITORIES = [
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

export const INDIA_STATES_AND_UTS: readonly string[] = [...INDIAN_STATES, ...INDIAN_UNION_TERRITORIES];

/** Older or alternative names returned by geocoders → the canonical name above. */
const ALIASES: Record<string, string> = {
  orissa: 'Odisha',
  uttaranchal: 'Uttarakhand',
  pondicherry: 'Puducherry',
  'nct of delhi': 'Delhi',
  'national capital territory of delhi': 'Delhi',
  'new delhi': 'Delhi',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'jammu & kashmir': 'Jammu and Kashmir',
};

const normalise = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Canonical state/UT name for free text from a geocoder or old records (null if unknown). */
export function matchIndianState(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = normalise(name);
  const direct = INDIA_STATES_AND_UTS.find((s) => normalise(s) === n);
  if (direct) return direct;
  return ALIASES[n] ?? ALIASES[n.replace(/&/g, 'and')] ?? null;
}

/** Map defaults: the whole country, not one city. */
export const INDIA_CENTER: LatLng = { lat: 22.5, lng: 80.0 };
export const INDIA_DEFAULT_ZOOM = 5;
/** Soft panning limit [[south, west], [north, east]] (a bounding box, not the border). */
export const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [5.5, 67.5],
  [37.8, 98.0],
];

/**
 * Validation box used by the backend (backend/src/utils/india.ts): mainland,
 * Lakshadweep and the Andaman & Nicobar Islands. Locations outside it are
 * rejected with 422 LOCATION_OUTSIDE_INDIA, so forms check it first.
 */
export const INDIA_VALIDATION_BOUNDS = { minLat: 6.0, maxLat: 37.6, minLng: 68.0, maxLng: 97.5 } as const;

export function isWithinIndiaBounds(p: LatLng): boolean {
  const b = INDIA_VALIDATION_BOUNDS;
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}
