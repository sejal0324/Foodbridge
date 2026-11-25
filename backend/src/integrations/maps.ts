import type { Logger } from '../config/logger.js';
import type { LatLng } from '../validators/common.js';

export type DistanceSource = 'ROAD_GOOGLE_ROUTES' | 'STRAIGHT_LINE_ESTIMATE';

/** Assumed urban average speed for clearly-labelled estimates when road data is unavailable. */
export const ESTIMATE_SPEED_KMH = 20;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface RouteEstimate {
  distanceM: number;
  durationS: number | null;
  source: DistanceSource;
  note: string;
}

export interface Matrix {
  distances: number[][];
  durations: number[][];
  source: DistanceSource;
  note: string;
}

/**
 * Google Maps Routes API adapter. Without GOOGLE_MAPS_SERVER_API_KEY (or when
 * the API fails) callers receive straight-line estimates that are labelled as
 * such; road distance and ETA are never invented.
 */
export class MapsClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Route distance/ETA between two points. Without road data, durationS is null (no invented ETA). */
  async route(origin: LatLng, destination: LatLng): Promise<RouteEstimate> {
    if (this.apiKey) {
      try {
        const res = await this.fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
            'x-goog-fieldmask': 'routes.distanceMeters,routes.duration',
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
            destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const body = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string }[] };
          const r = body.routes?.[0];
          if (r?.distanceMeters !== undefined && r.duration) {
            return { distanceM: r.distanceMeters, durationS: Number.parseInt(r.duration, 10), source: 'ROAD_GOOGLE_ROUTES', note: 'Road distance and traffic-aware ETA from Google Routes.' };
          }
        }
        this.logger.warn({ status: res.status }, 'Google Routes returned no route; using straight-line estimate');
      } catch (err) {
        this.logger.warn({ err: err instanceof Error ? err.message : err }, 'Google Routes unavailable; using straight-line estimate');
      }
    }
    return {
      distanceM: Math.round(haversineMeters(origin, destination)),
      durationS: null,
      source: 'STRAIGHT_LINE_ESTIMATE',
      note: this.apiKey ? 'Road routing is temporarily unavailable; showing straight-line distance only.' : 'Road routing is not configured; showing straight-line distance only.',
    };
  }

  /**
   * Distance/duration matrix for route optimisation. Falls back to
   * straight-line distance with durations estimated at a labelled average speed.
   */
  async matrix(points: LatLng[]): Promise<Matrix> {
    if (this.apiKey && points.length <= 25) {
      try {
        const waypoints = points.map((p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } }));
        const res = await this.fetchImpl('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
            'x-goog-fieldmask': 'originIndex,destinationIndex,distanceMeters,duration,condition',
          },
          body: JSON.stringify({ origins: waypoints, destinations: waypoints, travelMode: 'DRIVE' }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const cells = (await res.json()) as { originIndex: number; destinationIndex: number; distanceMeters?: number; duration?: string; condition?: string }[];
          const n = points.length;
          const distances = Array.from({ length: n }, () => Array<number>(n).fill(0));
          const durations = Array.from({ length: n }, () => Array<number>(n).fill(0));
          let complete = true;
          for (const c of cells) {
            if (c.condition && c.condition !== 'ROUTE_EXISTS') complete = false;
            (distances[c.originIndex] as number[])[c.destinationIndex] = c.distanceMeters ?? 0;
            (durations[c.originIndex] as number[])[c.destinationIndex] = c.duration ? Number.parseInt(c.duration, 10) : 0;
          }
          if (complete && cells.length === n * n) return { distances, durations, source: 'ROAD_GOOGLE_ROUTES', note: 'Road distances and durations from Google Routes.' };
        }
      } catch (err) {
        this.logger.warn({ err: err instanceof Error ? err.message : err }, 'Google route matrix unavailable; using estimates');
      }
    }
    const metersPerSecond = (ESTIMATE_SPEED_KMH * 1000) / 3600;
    const distances = points.map((a) => points.map((b) => Math.round(haversineMeters(a, b))));
    const durations = distances.map((row) => row.map((d) => Math.round(d / metersPerSecond)));
    return {
      distances,
      durations,
      source: 'STRAIGHT_LINE_ESTIMATE',
      note: `Travel times are estimates from straight-line distance at an assumed ${ESTIMATE_SPEED_KMH} km/h urban average, not road data.`,
    };
  }
}
