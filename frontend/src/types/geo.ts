/** GET /api/geo/search?q= (public, rate-limited, restricted to India). */
export interface GeoSearchResult {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface GeoSearchResponse {
  provider: 'GOOGLE' | 'OPENSTREETMAP';
  results: GeoSearchResult[];
}
