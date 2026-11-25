import { Info, Route, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { MapView, type MapMarker } from '@/components/map';
import { Badge, Banner, Card, CardBody, CardHeader, DataTable, StatusBadge } from '@/components/ui';
import type { LatLng } from '@/types';
import { formatDate, formatDuration, formatMeters, formatNumber, formatTime, formatWindow } from '@/utils/format';
import type { CollectionPlan, PlanStop } from '../types';
import { distanceSourceLabel } from '../utils';

const SOLVER: Record<string, { label: string; tone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral'; note?: string }> = {
  OPTIMAL: { label: 'Optimal route', tone: 'brand' },
  FEASIBLE: { label: 'Feasible route', tone: 'success', note: 'A valid route was found within the time limit; a slightly better one may exist.' },
  PARTIAL: { label: 'Partial route', tone: 'warning', note: 'Some stops could not fit the vehicle capacity or their time windows.' },
  INFEASIBLE: { label: 'No feasible route', tone: 'danger' },
  TIMEOUT: { label: 'Timed out', tone: 'danger' },
  UNAVAILABLE: { label: 'Optimiser unavailable', tone: 'warning' },
};

interface NumberedStop extends PlanStop {
  order: number | null;
}

/**
 * Collection plan: the map (numbered stops, route in sequence), the stops
 * table with planned arrivals, windows and drop reasons, and an honest
 * summary of the solver result and the distance source.
 */
export function PlanDetailView({ plan }: { plan: CollectionPlan }) {
  const unavailable = plan.solverStatus === 'UNAVAILABLE';
  const solver = SOLVER[plan.solverStatus ?? ''] ?? { label: plan.solverStatus ?? 'Unknown', tone: 'neutral' as const };

  const pickups = useMemo<NumberedStop[]>(() => {
    const list = plan.stops.filter((s) => s.type === 'PICKUP');
    const sequenced = list.filter((s) => s.sequence !== null && s.status !== 'DROPPED').sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const rest = list.filter((s) => !sequenced.includes(s));
    return [...sequenced.map((s, i) => ({ ...s, order: i + 1 })), ...rest.map((s) => ({ ...s, order: null }))];
  }, [plan.stops]);
  const dropped = pickups.filter((s) => s.status === 'DROPPED');
  const routed = pickups.filter((s) => s.order !== null);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [{ id: 'start', position: plan.start.location, kind: 'ngo', label: 'S', title: `Start: ${plan.start.address ?? 'NGO location'}` }];
    for (const s of pickups) {
      out.push({
        id: s.id,
        position: s.location,
        kind: s.order !== null ? 'pickup' : 'stale',
        label: s.order !== null ? String(s.order) : '–',
        title: `${s.order !== null ? `Stop ${s.order}` : s.status === 'DROPPED' ? 'Dropped' : 'Not sequenced'}: ${s.donorName ?? ''} ${s.foodName ? `(${s.foodName})` : ''}`.trim(),
      });
    }
    const sameEnd = plan.end.location.lat === plan.start.location.lat && plan.end.location.lng === plan.start.location.lng;
    if (!sameEnd) out.push({ id: 'end', position: plan.end.location, kind: 'destination', label: 'E', title: `End: ${plan.end.address ?? ''}` });
    return out;
  }, [plan.start, plan.end, pickups]);

  const path = useMemo<LatLng[]>(() => (unavailable || routed.length === 0 ? [] : [plan.start.location, ...routed.map((s) => s.location), plan.end.location]), [unavailable, routed, plan.start.location, plan.end.location]);

  return (
    <div className="space-y-6">
      {unavailable ? (
        <Banner tone="warning" title="Route optimisation is unavailable" icon={<TriangleAlert className="size-5" aria-hidden="true" />}>
          The optimiser could not be reached, so the stops below are not sequenced and no arrival times are planned. Decide the order yourself or create the plan again later.
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title="Route"
          icon={<Route className="size-4" aria-hidden="true" />}
          description={`${formatDate(plan.planDate)} · start ${formatTime(plan.startTime)} · vehicle capacity ${formatNumber(plan.vehicleCapacity)}`}
          actions={<Badge tone={solver.tone}>{solver.label}</Badge>}
        />
        <CardBody className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-400">Total distance</dt>
              <dd className="text-xl font-semibold text-white tabular-nums">{plan.totalDistanceM !== null ? formatMeters(plan.totalDistanceM) : '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-400">Total duration</dt>
              <dd className="text-xl font-semibold text-white tabular-nums">{plan.totalDurationS !== null ? formatDuration(plan.totalDurationS) : '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-400">Stops</dt>
              <dd className="text-xl font-semibold text-white tabular-nums">
                {routed.length} planned{dropped.length > 0 ? ` · ${dropped.length} dropped` : ''}
              </dd>
            </div>
          </dl>
          <p className="flex items-start gap-2 text-xs text-slate-400" data-testid="distance-source">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {distanceSourceLabel(plan.distanceSource)}
          </p>
          {solver.note ? <p className="text-xs text-slate-400">{solver.note}</p> : null}
          <MapView ariaLabel={`Collection route with ${routed.length} numbered stops${dropped.length ? ` and ${dropped.length} dropped` : ''}`} markers={markers} path={path} fitToContent height={380} />
          <p className="text-xs text-slate-500">S start · numbers are the stop order · E end{dropped.length > 0 || unavailable ? ' · – not in the route' : ''}</p>
          {plan.explanation ? <p className="text-sm leading-relaxed text-slate-200">{plan.explanation}</p> : null}
          {plan.infeasibilityReasons && plan.infeasibilityReasons.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-white">Why some stops could not be planned</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-300">
                {plan.infeasibilityReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Stops" as="h3" />
        <CardBody>
          <DataTable
            caption="Collection stops"
            rows={pickups}
            rowKey={(s) => s.id}
            columns={[
              { key: 'order', header: '#', cell: (s) => (s.order !== null ? <span className="font-semibold text-white">{s.order}</span> : <span className="text-slate-500">–</span>) },
              {
                key: 'donor',
                header: 'Donor and food',
                cell: (s) => (
                  <div>
                    <p className="text-white">{s.donorName ?? '—'}</p>
                    <p className="text-xs text-slate-400">{s.foodName ?? ''}</p>
                  </div>
                ),
              },
              { key: 'address', header: 'Address', cell: (s) => s.address ?? '—' },
              { key: 'arrival', header: 'Planned arrival', cell: (s) => (s.plannedArrivalAt ? formatTime(s.plannedArrivalAt) : '—') },
              { key: 'window', header: 'Time window', cell: (s) => (s.windowStart && s.windowEnd ? formatWindow(s.windowStart, s.windowEnd) : '—') },
              { key: 'qty', header: 'Quantity', align: 'right', cell: (s) => formatNumber(s.quantity) },
              {
                key: 'status',
                header: 'Status',
                cell: (s) =>
                  s.status === 'DROPPED' ? (
                    <div>
                      <Badge tone="danger">Dropped</Badge>
                      {s.dropReason ? <p className="mt-1 text-xs text-red-300">{s.dropReason}</p> : null}
                    </div>
                  ) : (
                    <StatusBadge status={s.status} />
                  ),
              },
            ]}
          />
          {plan.stops.some((s) => s.type === 'DROP_OFF') ? (
            <p className="mt-3 text-xs text-slate-500">
              Ends at {plan.end.address ?? 'your NGO'}
              {(() => {
                const end = plan.stops.find((s) => s.type === 'DROP_OFF');
                return end?.plannedArrivalAt ? ` around ${formatTime(end.plannedArrivalAt)}` : '';
              })()}
              .
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
