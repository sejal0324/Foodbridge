import { Navigation, Radio } from 'lucide-react';
import { useMemo } from 'react';
import { MapView, type MapMarker } from '@/components/map';
import { Banner, Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import type { LatLng, TrackingSessionView } from '@/types';
import { formatDateTime, formatDuration, formatMeters, formatTime } from '@/utils/format';
import { effectiveLiveness } from '../liveness';
import { useTrackingSession } from '../useTrackingSession';
import { LivenessBadge } from './LivenessBadge';

/** ETA / distance text. Straight-line distances and missing ETAs are labelled, never invented. */
export function EtaSummary({ session, stale }: { session: TrackingSessionView; stale: boolean }) {
  const eta = session.eta;
  if (!eta) return <p className="text-sm text-slate-400">ETA unavailable — no position or destination yet.</p>;
  const road = eta.source === 'ROAD_GOOGLE_ROUTES';
  return (
    <div className="space-y-1 text-sm">
      <p className="text-slate-200">
        {eta.etaSeconds === null ? (
          <span>ETA unavailable</span>
        ) : (
          <span>
            {stale ? 'Last estimated arrival' : 'Estimated arrival'} in <strong className="text-white">{formatDuration(eta.etaSeconds)}</strong>
          </span>
        )}
        <span className="text-slate-500"> · </span>
        <span>
          {formatMeters(eta.remainingDistanceM)} {road ? 'by road' : <span className="text-slate-400">(straight-line estimate)</span>}
        </span>
      </p>
      <p className="text-xs text-slate-500">{eta.note}</p>
    </div>
  );
}

/**
 * LiveTrack viewer: map with the representative's last position, the path
 * travelled and the destination; liveness, ETA and the last update time.
 * Stale or ended data is labelled as such and never presented as live.
 */
export function TrackingViewer({ sessionId, destinationLabel = 'Pickup point', fallbackDestination }: { sessionId: string; destinationLabel?: string; fallbackDestination?: LatLng | null }) {
  const { session, path, joined } = useTrackingSession(sessionId);
  const now = useNow(5_000);
  const s = session.data;
  const live = s ? effectiveLiveness(s, now) : null;
  const pathPoints = useMemo(() => (path.data ? [...path.data].reverse().map((p) => ({ lat: p.lat, lng: p.lng })) : []), [path.data]);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    const dest = s?.destination ?? fallbackDestination;
    if (dest) out.push({ id: 'dest', position: dest, kind: 'destination', label: 'D', title: destinationLabel });
    if (s?.lastPosition) {
      const fresh = live?.liveness === 'LIVE';
      out.push({
        id: 'rep',
        position: { lat: s.lastPosition.lat, lng: s.lastPosition.lng },
        kind: fresh ? 'representative' : 'stale',
        label: 'R',
        title: `${s.representativeName} — ${fresh ? 'live position' : `last known position (${formatTime(s.lastPosition.recordedAt)})`}`,
      });
    }
    return out;
  }, [s, live?.liveness, fallbackDestination, destinationLabel]);

  return (
    <Card>
      <CardHeader
        title="LiveTrack"
        description={s ? `${s.representativeName} · ${s.stage === 'TO_PICKUP' ? 'on the way to you' : 'on the way to the destination'}` : 'Representative location'}
        icon={<Navigation className="size-4" aria-hidden="true" />}
        actions={live ? <LivenessBadge liveness={live.liveness} ageSeconds={live.ageSeconds} /> : null}
      />
      <CardBody className="space-y-4">
        {session.isPending ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : session.isError ? (
          <ErrorState error={session.error} compact title="Tracking is unavailable" onRetry={() => void session.refetch()} />
        ) : s && live ? (
          <>
            {live.liveness === 'STALE' ? (
              <Banner tone="warning" title="Location is not live">
                The last position is from {formatDateTime(s.lastPosition?.recordedAt)}. The representative’s phone may have lost signal or stopped sharing.
              </Banner>
            ) : null}
            {live.liveness === 'ENDED' ? (
              <Banner tone="info" title="Tracking has ended">
                {s.endReason ? `Reason: ${s.endReason}. ` : ''}The map shows the last known position.
              </Banner>
            ) : null}
            <MapView ariaLabel={`Map showing ${s.representativeName}'s ${live.liveness === 'LIVE' ? 'live' : 'last known'} position and the ${destinationLabel.toLowerCase()}`} markers={markers} path={pathPoints} fitToContent height={300} />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <EtaSummary session={s} stale={live.liveness !== 'LIVE'} />
              <div className="text-right text-xs text-slate-500">
                {s.lastPosition ? <p>Last update {formatTime(s.lastPosition.recordedAt)}</p> : <p>No position received yet</p>}
                <p className="mt-0.5 inline-flex items-center gap-1">
                  <Radio className="size-3" aria-hidden="true" /> {joined ? 'Real-time updates on' : 'Refreshing every 10 s'}
                </p>
              </div>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
