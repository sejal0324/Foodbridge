import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { apiGet } from '@/services/apiClient';
import type { GeoSearchResponse, GeoSearchResult } from '@/types';
import { matchIndianState } from '@/utils/india';

export const GEO_MIN_CHARS = 3;
export const GEO_DEBOUNCE_MS = 400;

/** Address search (India only) for `q`, debounced and cached. */
export function useGeoSearch(q: string, active = true) {
  const term = useDebouncedValue(q.trim(), GEO_DEBOUNCE_MS);
  const enabled = active && term.length >= GEO_MIN_CHARS;
  const query = useQuery({
    queryKey: ['geo', 'search', term.toLowerCase()],
    queryFn: () => apiGet<GeoSearchResponse>('/geo/search', { q: term }),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { ...query, term, enabled, debouncing: q.trim() !== term };
}

const ADMIN_UNIT = /\b(district|subdistrict|sub-district|metropolitan area|taluka|tehsil|division|zone \d+.*)$/i;

/**
 * Street-level part of a geocoder label for an address line: drops "India",
 * the city/state/postal code (they have their own fields) and administrative
 * units such as "Pune District", keeping at most the 4 most specific parts.
 */
export function addressLineFrom(r: GeoSearchResult, max = 300): string {
  const drop = new Set(['india', r.city, r.state, r.postalCode, r.state && r.postalCode ? `${r.state} ${r.postalCode}` : null].filter(Boolean).map((s) => String(s).toLowerCase()));
  const parts = r.label
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !drop.has(p.toLowerCase()) && !ADMIN_UNIT.test(p));
  return (parts.slice(0, 4).join(', ') || r.label).slice(0, max);
}

export interface AddressFieldAccess {
  get: (field: 'addressLine' | 'city' | 'state' | 'postalCode') => string | null | undefined;
  set: (field: 'addressLine' | 'city' | 'state' | 'postalCode', value: string) => void;
}

/**
 * Pre-fills address fields from a search result, ONLY where they are empty.
 * The state is normalised to the official state/UT list (skipped if unknown).
 */
export function fillEmptyAddressFields(r: GeoSearchResult, fields: AddressFieldAccess, available: ('addressLine' | 'city' | 'state' | 'postalCode')[] = ['addressLine', 'city', 'state', 'postalCode']): void {
  const candidates = {
    addressLine: addressLineFrom(r),
    city: r.city?.trim() || null,
    state: matchIndianState(r.state),
    postalCode: r.postalCode?.trim() || null,
  };
  for (const field of available) {
    const value = candidates[field];
    const current = fields.get(field);
    if (value && (!current || current.trim() === '')) fields.set(field, value);
  }
}
