import { APIProvider, Map, Marker, Polyline, useMap, type MapMouseEvent } from '@vis.gl/react-google-maps';
import { useEffect, useMemo, useRef } from 'react';
import { GOOGLE_MAPS_BROWSER_API_KEY } from '@/services/config';
import type { LatLng } from '@/types';
import { cn } from '@/utils/cn';
import { INDIA_BOUNDS, INDIA_CENTER, INDIA_DEFAULT_ZOOM } from '@/utils/india';
import { DETAIL_ZOOM, FIT_MAX_ZOOM, SINGLE_POINT_ZOOM, pointsKey } from './fit';
import { MARKER_COLOURS, type MapViewProps } from './types';

const [[SOUTH, WEST], [NORTH, EAST]] = INDIA_BOUNDS;

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  const fitted = useRef(false);
  const key = pointsKey(points);
  useEffect(() => {
    if (!map || points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    const view = map.getBounds();
    const visible = Boolean(view && points.every((p) => view.contains(p)));
    if (fitted.current && visible && (map.getZoom() ?? 0) >= DETAIL_ZOOM) return;
    fitted.current = true;
    if (points.length === 1) {
      map.setCenter(points[0] as LatLng);
      map.setZoom(Math.max(Math.min(map.getZoom() ?? SINGLE_POINT_ZOOM, FIT_MAX_ZOOM), SINGLE_POINT_ZOOM));
    } else {
      map.fitBounds(bounds, 40);
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > FIT_MAX_ZOOM) map.setZoom(FIT_MAX_ZOOM);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Google Maps rendering of <MapView>, used only when VITE_GOOGLE_MAPS_BROWSER_API_KEY is set. */
export default function GoogleMapView({ ariaLabel, center, zoom, markers = [], path, onPick, picked, fitToContent = true, height = 320, className }: MapViewProps) {
  const all = useMemo(() => (picked ? [...markers, { id: '__picked', position: picked, kind: 'selected' as const, title: 'Selected location' }] : markers), [markers, picked]);
  const points = useMemo(() => [...all.map((m) => m.position), ...(path ?? [])], [all, path]);
  const initialCenter = points[0] ?? center ?? INDIA_CENTER;
  const initialZoom = points.length > 0 || center ? SINGLE_POINT_ZOOM : (zoom ?? INDIA_DEFAULT_ZOOM);
  const onClick = (e: MapMouseEvent) => {
    const ll = e.detail.latLng;
    if (onPick && ll) onPick({ lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 });
  };
  return (
    <div role="region" aria-label={ariaLabel} className={cn('overflow-hidden rounded-xl border border-white/10', className)} style={{ height }}>
      <APIProvider apiKey={GOOGLE_MAPS_BROWSER_API_KEY}>
        <Map
          defaultCenter={initialCenter}
          defaultZoom={initialZoom}
          minZoom={4}
          restriction={{ latLngBounds: { north: NORTH, south: SOUTH, east: EAST, west: WEST }, strictBounds: false }}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          onClick={onPick ? onClick : undefined}
          colorScheme="DARK"
        >
          {all.map((m) => (
            <Marker
              key={m.id}
              position={m.position}
              title={m.title}
              label={m.label ? { text: m.label, color: '#fff', fontWeight: '700' } : undefined}
              icon={{ path: 0, scale: 11, fillColor: MARKER_COLOURS[m.kind ?? 'pickup'], fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }}
            />
          ))}
          {path && path.length > 1 ? <Polyline path={path} strokeColor="#7c3aed" strokeOpacity={0.85} strokeWeight={4} /> : null}
          {fitToContent && points.length > 0 ? <FitBounds points={points} /> : null}
        </Map>
      </APIProvider>
    </div>
  );
}
