import type { LatLng } from '@/types';

export const FIT_MAX_ZOOM = 15;
/** Zoom used to show a single point. */
export const SINGLE_POINT_ZOOM = 14;
/** Below this zoom a single point is "zoomed in to"; at or above it the view is left alone. */
export const DETAIL_ZOOM = 12;

/** Stable key of a set of points (changes only when coordinates change). */
export function pointsKey(points: LatLng[]): string {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
}
