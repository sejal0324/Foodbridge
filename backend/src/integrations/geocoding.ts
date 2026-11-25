import type { Logger } from '../config/logger.js';
import { isInIndia } from '../utils/india.js';

export interface GeoResult {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface GeoResponse {
  provider: 'GOOGLE' | 'OPENSTREETMAP';
  results: GeoResult[];
}

export class GeocodingUnavailableError extends Error {}

const CACHE_TTL_MS = 24 * 3_600_000;
const CACHE_MAX = 1000;
/** Nominatim usage policy: at most one request per second, identified by a User-Agent. */
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'FoodBridgeAI/1.0 (food redistribution platform; https://github.com/sejal0324/Foodbridge)';

/**
 * Address search and reverse geocoding restricted to India. Uses the Google
 * Geocoding API when GOOGLE_MAPS_SERVER_API_KEY is set, otherwise
 * OpenStreetMap Nominatim (rate-limited, cached, attributed).
 */
export class GeocodingClient {
  private readonly cache = new Map<string, { at: number; value: GeoResponse }>();
  private nominatimQueue: Promise<void> = Promise.resolve();
  private lastNominatimAt = 0;

  constructor(
    private readonly googleKey: string | undefined,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<GeoResponse> {
    return this.cached(`s:${query.toLowerCase()}`, () => (this.googleKey ? this.googleSearch(query) : this.nominatimSearch(query)));
  }

  async reverse(lat: number, lng: number): Promise<GeoResponse> {
    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    return this.cached(key, () => (this.googleKey ? this.googleReverse(lat, lng) : this.nominatimReverse(lat, lng)));
  }

  private async cached(key: string, load: () => Promise<GeoResponse>): Promise<GeoResponse> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await load();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  // --- Google -----------------------------------------------------------------
  private async google(params: Record<string, string>): Promise<GeoResponse> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    for (const [k, v] of Object.entries({ ...params, region: 'in', language: 'en', key: this.googleKey as string })) url.searchParams.set(k, v);
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(6000) });
      const body = (await res.json()) as {
        status: string;
        results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } }; address_components: { long_name: string; types: string[] }[] }[];
      };
      if (!res.ok || !['OK', 'ZERO_RESULTS'].includes(body.status)) throw new GeocodingUnavailableError(`Google geocoding status ${body.status}`);
      const pick = (c: { long_name: string; types: string[] }[], type: string) => c.find((x) => x.types.includes(type))?.long_name ?? null;
      return {
        provider: 'GOOGLE',
        results: (body.results ?? [])
          .map((r) => ({
            label: r.formatted_address,
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
            city: pick(r.address_components, 'locality') ?? pick(r.address_components, 'administrative_area_level_2'),
            state: pick(r.address_components, 'administrative_area_level_1'),
            postalCode: pick(r.address_components, 'postal_code'),
          }))
          .filter((r) => isInIndia(r))
          .slice(0, 8),
      };
    } catch (err) {
      if (err instanceof GeocodingUnavailableError) throw err;
      this.logger.warn({ err: err instanceof Error ? err.message : err }, 'Google geocoding failed');
      throw new GeocodingUnavailableError('Location search is temporarily unavailable.');
    }
  }

  private googleSearch(q: string) {
    return this.google({ address: q, components: 'country:IN' });
  }

  private googleReverse(lat: number, lng: number) {
    return this.google({ latlng: `${lat},${lng}` });
  }

  // --- OpenStreetMap Nominatim -------------------------------------------------
  private async nominatim(path: string, params: Record<string, string>): Promise<GeoResponse> {
    // Serialise requests and space them out (≥ 1 s) as the Nominatim usage policy requires.
    const turn = this.nominatimQueue.then(async () => {
      const wait = this.lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastNominatimAt = Date.now();
    });
    this.nominatimQueue = turn.catch(() => undefined);
    await turn;
    const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
    for (const [k, v] of Object.entries({ ...params, format: 'jsonv2', addressdetails: '1', 'accept-language': 'en' })) url.searchParams.set(k, v);
    try {
      const res = await this.fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new GeocodingUnavailableError(`Nominatim HTTP ${res.status}`);
      const raw = (await res.json()) as unknown;
      const list = (Array.isArray(raw) ? raw : [raw]) as {
        display_name?: string;
        lat?: string;
        lon?: string;
        address?: { city?: string; town?: string; village?: string; suburb?: string; state_district?: string; county?: string; state?: string; postcode?: string; country_code?: string };
      }[];
      return {
        provider: 'OPENSTREETMAP',
        results: list
          .filter((r) => r.lat && r.lon && (r.address?.country_code ?? 'in') === 'in')
          .map((r) => ({
            label: r.display_name ?? '',
            lat: Number(r.lat),
            lng: Number(r.lon),
            city: r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.state_district ?? r.address?.county ?? null,
            state: r.address?.state ?? null,
            postalCode: r.address?.postcode ?? null,
          }))
          .filter((r) => isInIndia(r))
          .slice(0, 8),
      };
    } catch (err) {
      if (err instanceof GeocodingUnavailableError) throw err;
      this.logger.warn({ err: err instanceof Error ? err.message : err }, 'Nominatim geocoding failed');
      throw new GeocodingUnavailableError('Location search is temporarily unavailable.');
    }
  }

  private nominatimSearch(q: string) {
    return this.nominatim('search', { q, countrycodes: 'in', limit: '8' });
  }

  private nominatimReverse(lat: number, lng: number) {
    return this.nominatim('reverse', { lat: String(lat), lon: String(lng), zoom: '18' });
  }
}
