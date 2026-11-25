import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui';
import { GOOGLE_MAPS_BROWSER_API_KEY } from '@/services/config';
import type { MapViewProps } from './types';

const LeafletMap = lazy(() => import('./LeafletMap'));
const GoogleMapView = lazy(() => import('./GoogleMap'));

/**
 * The single map abstraction: markers, an optional polyline path and
 * click-to-pick. OpenStreetMap (Leaflet) by default; Google Maps JS only when
 * VITE_GOOGLE_MAPS_BROWSER_API_KEY is configured. Map code is lazy-loaded.
 */
export function MapView(props: MapViewProps) {
  const Impl = GOOGLE_MAPS_BROWSER_API_KEY ? GoogleMapView : LeafletMap;
  return (
    <Suspense
      fallback={
        <div style={{ height: props.height ?? 320 }} className={props.className}>
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}
