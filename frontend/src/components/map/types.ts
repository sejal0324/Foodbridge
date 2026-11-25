import type { LatLng } from '@/types';

export type MarkerKind = 'pickup' | 'destination' | 'representative' | 'donor' | 'ngo' | 'selected' | 'stale';

export interface MapMarker {
  id: string;
  position: LatLng;
  kind?: MarkerKind;
  /** Short text inside the marker (1–2 characters). */
  label?: string;
  /** Tooltip / accessible title. */
  title?: string;
}

export interface MapViewProps {
  /** Accessible description of what the map shows. */
  ariaLabel: string;
  /** Initial centre when there is nothing to fit (defaults to India). */
  center?: LatLng | null;
  /** Initial zoom when there is nothing to fit (defaults to 5, the whole country). */
  zoom?: number;
  markers?: MapMarker[];
  /** Polyline (e.g. a LiveTrack path), oldest point first. */
  path?: LatLng[];
  /** Enables click-to-pick; called with the clicked coordinates. */
  onPick?: (point: LatLng) => void;
  /** Currently picked location (rendered as a "selected" marker). */
  picked?: LatLng | null;
  /**
   * Auto-fit to markers + path (default true): padding, max zoom 15, and only
   * re-fitting when content leaves the view, so live updates do not fight the user.
   */
  fitToContent?: boolean;
  height?: number | string;
  className?: string;
}

export const MARKER_COLOURS: Record<MarkerKind, string> = {
  pickup: '#2E7D32',
  destination: '#0284c7',
  representative: '#7c3aed',
  donor: '#2E7D32',
  ngo: '#0284c7',
  selected: '#ea580c',
  stale: '#64748b',
};
