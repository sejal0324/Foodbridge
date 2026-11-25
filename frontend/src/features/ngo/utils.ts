import type { TrackingStage } from './types';

/** "Copy" helper for codes and links; returns whether the clipboard accepted it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** Haversine distance in metres (straight line). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** LiveTrack leg for a pickup status: to the donor before handover, to the destination after it. */
export function trackingStageFor(status: string): TrackingStage | null {
  if (status === 'ASSIGNED' || status === 'EN_ROUTE') return 'TO_PICKUP';
  if (status === 'HANDED_OVER' || status === 'IN_TRANSIT') return 'TO_DESTINATION';
  return null;
}

/** Labels the provenance of distances and durations: estimates are never presented as road data. */
export function distanceSourceLabel(source: string | null | undefined): string {
  if (source === 'ROAD_GOOGLE_ROUTES') return 'Road distances and travel times (Google Routes)';
  return 'Straight-line estimates, not road distances (travel times assume an average urban speed)';
}
