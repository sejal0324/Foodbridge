/**
 * FoodBridge operates across India. This is a coarse bounding box covering the
 * mainland, Lakshadweep and the Andaman & Nicobar Islands; it rejects clearly
 * wrong coordinates (e.g. a swapped lat/lng or a default 0,0) without needing
 * a boundary dataset. Precise country checks come from geocoding (country=IN).
 */
export const INDIA_BOUNDS = { minLat: 6.0, maxLat: 37.6, minLng: 68.0, maxLng: 97.5 } as const;

export function isInIndia(p: { lat: number; lng: number }): boolean {
  return p.lat >= INDIA_BOUNDS.minLat && p.lat <= INDIA_BOUNDS.maxLat && p.lng >= INDIA_BOUNDS.minLng && p.lng <= INDIA_BOUNDS.maxLng;
}

/** 28 states and 8 union territories. */
export const INDIAN_STATES_AND_UTS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;
