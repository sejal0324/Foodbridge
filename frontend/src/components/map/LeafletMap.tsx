import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng } from '@/types';
import { cn } from '@/utils/cn';
import { INDIA_BOUNDS, INDIA_CENTER, INDIA_DEFAULT_ZOOM } from '@/utils/india';
import { DETAIL_ZOOM, FIT_MAX_ZOOM, SINGLE_POINT_ZOOM, pointsKey } from './fit';
import { MARKER_COLOURS, type MapMarker, type MapViewProps } from './types';

function iconFor(m: MapMarker): L.DivIcon {
  const colour = MARKER_COLOURS[m.kind ?? 'pickup'];
  const size = m.kind === 'representative' ? 30 : 26;
  return L.divIcon({
    className: '',
    html: `<div class="fb-marker" style="width:${size}px;height:${size}px;background:${colour}">${m.label ? escapeHtml(m.label) : ''}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function ClickToPick({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lng: Math.round(e.latlng.lng * 1e6) / 1e6 });
    },
  });
  return null;
}

/**
 * Fits the view to the content: the first time, and later only when some point
 * is outside the current view (so live tracking updates and refinement clicks
 * do not keep re-zooming the map).
 */
function FitToContent({ points }: { points: LatLng[] }) {
  const map = useMap();
  const fitted = useRef(false);
  const key = pointsKey(points);
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    const visible = map.getBounds().pad(-0.05).contains(bounds);
    if (fitted.current && visible && map.getZoom() >= DETAIL_ZOOM) return;
    fitted.current = true;
    if (points.length === 1) map.setView(points[0] as LatLng, Math.max(Math.min(map.getZoom(), FIT_MAX_ZOOM), SINGLE_POINT_ZOOM));
    else map.fitBounds(bounds, { padding: [32, 32], maxZoom: FIT_MAX_ZOOM });
    // `key` captures the coordinates; `points` identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Recentres when the `center` prop changes and there is no content to fit. */
function Recenter({ center }: { center: LatLng | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, Math.max(map.getZoom(), SINGLE_POINT_ZOOM));
  }, [map, center]);
  return null;
}

/** OpenStreetMap rendering of <MapView> (default provider). India-centred and softly bounded to India. */
export default function LeafletMap({ ariaLabel, center, zoom, markers = [], path, onPick, picked, fitToContent = true, height = 320, className }: MapViewProps) {
  const allMarkers = useMemo(() => (picked ? [...markers, { id: '__picked', position: picked, kind: 'selected' as const, title: 'Selected location' }] : markers), [markers, picked]);
  const points = useMemo(() => [...allMarkers.map((m) => m.position), ...(path ?? [])], [allMarkers, path]);
  const initialCenter = points[0] ?? center ?? INDIA_CENTER;
  const initialZoom = points.length > 0 || center ? SINGLE_POINT_ZOOM : (zoom ?? INDIA_DEFAULT_ZOOM);
  return (
    <div role="region" aria-label={ariaLabel} className={cn('relative overflow-hidden rounded-xl border border-white/10', onPick && 'cursor-crosshair', className)} style={{ height }}>
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={initialZoom}
        minZoom={4}
        maxBounds={INDIA_BOUNDS}
        maxBoundsViscosity={0.8}
        scrollWheelZoom={false}
        className="h-full w-full"
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {path && path.length > 1 ? <Polyline positions={path.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: '#7c3aed', weight: 4, opacity: 0.8 }} /> : null}
        {allMarkers.map((m) => (
          <Marker key={m.id} position={[m.position.lat, m.position.lng]} icon={iconFor(m)} title={m.title} alt={m.title}>
            {m.title ? <Tooltip direction="top" offset={[0, -12]}>{m.title}</Tooltip> : null}
          </Marker>
        ))}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
        {fitToContent && points.length > 0 ? <FitToContent points={points} /> : <Recenter center={points.length === 0 ? center : null} />}
      </MapContainer>
    </div>
  );
}
