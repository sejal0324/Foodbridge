import { MapPin } from 'lucide-react';
import type { DistanceSource } from '@/types';
import { cn } from '@/utils/cn';
import { formatDistance } from '@/utils/format';

/**
 * Distance with its provenance, always explicit: "3.7 km · straight-line
 * estimate" unless the backend says it is a road distance.
 */
export function DistanceLabel({ km, source, className }: { km: number | null | undefined; source: DistanceSource | string | null | undefined; className?: string }) {
  if (km === null || km === undefined) return <span className={cn('text-sm text-slate-500', className)}>Distance unknown</span>;
  const road = source === 'ROAD_GOOGLE_ROUTES';
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-slate-300', className)}>
      <MapPin className="size-3.5 text-slate-500" aria-hidden="true" />
      <span className="tabular-nums">{formatDistance(km)}</span>
      <span className="text-slate-500">·</span>
      <span className={road ? 'text-slate-300' : 'text-slate-400'}>{road ? 'road distance' : 'straight-line estimate'}</span>
    </span>
  );
}
