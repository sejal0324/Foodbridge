import { Route, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { QueryState } from '@/components/feedback';
import { LocationPicker } from '@/components/map';
import { Badge, Banner, Button, Card, CardBody, CardHeader, Checkbox, Countdown, DataTable, EmptyState, Field, FieldSet, Input, PageHeader, Select, SkeletonList, StatusBadge, useToast } from '@/components/ui';
import { useAllocations } from '@/features/donations/api';
import { ApiError } from '@/services/apiError';
import type { Allocation, LatLng } from '@/types';
import { formatDate, formatDuration, formatMeters, formatQuantity, formatRelative, fromIstInputValue, istInputToMillis, toIstInputValue, todayIst } from '@/utils/format';
import { useCollectionPlans, useCreatePlan, useNgoProfile, useRepresentatives } from '../api';
import type { NgoProfile, PlanCreateInput } from '../types';

const MAX_STOPS = 25;

export default function PlanningPage() {
  const plans = useCollectionPlans();
  return (
    <>
      <PageHeader
        title="Route planning"
        description="Plan one trip that collects several reserved donations, respecting each pickup window and your vehicle’s capacity. Plans are suggestions: your team still verifies every pickup."
      />
      <div className="space-y-6">
        <CreatePlanCard />
        <Card>
          <CardHeader title="Your plans" as="h3" icon={<Route className="size-4" aria-hidden="true" />} />
          <CardBody>
            <QueryState query={plans} empty={<EmptyState compact title="No plans yet" description="Create a plan above from your reserved collections." />}>
              {(rows) => (
                <DataTable
                  caption="Collection plans"
                  rows={rows}
                  rowKey={(p) => p.id}
                  columns={[
                    {
                      key: 'date',
                      header: 'Date',
                      cell: (p) => (
                        <Link to={`/ngo/planning/${p.id}`} className="font-medium text-white hover:underline">
                          {formatDate(p.planDate)}
                        </Link>
                      ),
                    },
                    { key: 'stops', header: 'Stops', cell: (p) => p.stopCount },
                    { key: 'solver', header: 'Route', cell: (p) => <Badge tone={p.solverStatus === 'UNAVAILABLE' || p.solverStatus === 'INFEASIBLE' ? 'warning' : 'neutral'}>{(p.solverStatus ?? 'unknown').toLowerCase()}</Badge> },
                    {
                      key: 'distance',
                      header: 'Distance · time',
                      cell: (p) =>
                        p.totalDistanceM !== null ? (
                          <span>
                            {formatMeters(p.totalDistanceM)} · {formatDuration(p.totalDurationS)}
                            <span className="block text-xs text-slate-400">{p.distanceSource === 'ROAD_GOOGLE_ROUTES' ? 'road' : 'straight-line estimate'}</span>
                          </span>
                        ) : (
                          '—'
                        ),
                    },
                    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
                    { key: 'created', header: 'Created', cell: (p) => formatRelative(p.createdAt) },
                  ]}
                />
              )}
            </QueryState>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function defaultStartTime(): string {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toIstInputValue(d);
}

function CreatePlanCard() {
  const profile = useNgoProfile();
  const reserved = useAllocations({ status: 'RESERVED', pageSize: 100 });
  const assigned = useAllocations({ status: 'PICKUP_ASSIGNED', pageSize: 100 });
  const loading = profile.isPending || reserved.isPending || assigned.isPending;
  const error = profile.error ?? reserved.error ?? assigned.error;
  const candidates = useMemo(() => [...(reserved.data?.items ?? []), ...(assigned.data?.items ?? [])].sort((a, b) => Date.parse(a.pickupDeadline) - Date.parse(b.pickupDeadline)), [reserved.data, assigned.data]);

  return (
    <Card>
      <CardHeader title="New plan" icon={<Wand2 className="size-4" aria-hidden="true" />} description="Choose reserved or assigned collections to visit in one trip." />
      <CardBody>
        {loading ? (
          <SkeletonList rows={3} />
        ) : error ? (
          <Banner tone="danger">{ApiError.from(error).message}</Banner>
        ) : candidates.length === 0 ? (
          <EmptyState compact title="Nothing to plan" description="Plans are made from collections that are reserved for you and not yet picked up." />
        ) : profile.data ? (
          <PlanForm profile={profile.data} candidates={candidates} />
        ) : null}
      </CardBody>
    </Card>
  );
}

function PlanForm({ profile, candidates }: { profile: NgoProfile; candidates: Allocation[] }) {
  const create = useCreatePlan();
  const reps = useRepresentatives();
  const navigate = useNavigate();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [planDate, setPlanDate] = useState(() => todayIst());
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [capacity, setCapacity] = useState(profile.defaultVehicleCapacity ? String(profile.defaultVehicleCapacity) : '');
  const [repId, setRepId] = useState('');
  const [customStart, setCustomStart] = useState(!profile.location);
  const [customEnd, setCustomEnd] = useState(false);
  const [start, setStart] = useState<LatLng | null>(profile.location);
  const [end, setEnd] = useState<LatLng | null>(profile.location);
  const [error, setError] = useState<string | null>(null);

  const capacityNumber = Number(capacity);
  const selectedQty = candidates.filter((c) => selected.includes(c.id)).reduce((s, c) => s + c.quantity, 0);
  const issues = {
    selected: selected.length === 0 ? 'Choose at least one collection' : selected.length > MAX_STOPS ? `At most ${MAX_STOPS} stops per plan` : undefined,
    planDate: /^\d{4}-\d{2}-\d{2}$/.test(planDate) ? undefined : 'Enter a date',
    startTime: Number.isNaN(istInputToMillis(startTime)) ? 'Enter a date and time' : undefined,
    capacity: capacity.trim() === '' && !profile.defaultVehicleCapacity ? 'Enter the vehicle capacity' : capacity.trim() !== '' && (!Number.isInteger(capacityNumber) || capacityNumber < 1 || capacityNumber > 100_000) ? 'Use a whole number from 1 to 100,000' : undefined,
    start: (customStart || !profile.location) && !start ? 'Choose a start point' : undefined,
    end: (customEnd || !profile.location) && !end ? 'Choose an end point' : undefined,
  };
  const valid = Object.values(issues).every((v) => v === undefined);

  const submit = () => {
    setError(null);
    if (!valid) return;
    const input: PlanCreateInput = {
      planDate,
      startTime: fromIstInputValue(startTime),
      allocationIds: selected,
      ...(capacity.trim() ? { vehicleCapacity: capacityNumber } : {}),
      ...(repId ? { representativeId: repId } : {}),
      ...(customStart && start ? { start: { location: start } } : {}),
      ...(customEnd && end ? { end: { location: end } } : {}),
    };
    create.mutate(input, {
      onSuccess: (plan) => {
        toast.success('Plan created', plan.solverStatus === 'UNAVAILABLE' ? 'The optimiser was unavailable: stops are not sequenced.' : 'Review the route and confirm it.');
        navigate(`/ngo/planning/${plan.id}`);
      },
      onError: (e) => {
        const err = ApiError.from(e);
        setError(err.code === 'RATE_LIMITED' ? 'Too many plans in a short time. Wait a minute and try again.' : err.message);
      },
    });
  };

  return (
    <div className="space-y-5">
      {error ? (
        <Banner tone="danger" live>
          {error}
        </Banner>
      ) : null}
      <FieldSet legend="Collections to visit" hint={`${selected.length} selected · ${selectedQty} units`} error={selected.length > MAX_STOPS ? issues.selected : undefined}>
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {candidates.map((a) => (
            <li key={a.id} className="rounded-lg border border-white/10 p-3">
              <Checkbox
                checked={selected.includes(a.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))}
                label={`${a.foodName} · ${formatQuantity(a.quantity, a.unit)}`}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      {a.donor.name} · {a.address}
                    </span>
                    <StatusBadge status={a.status} />
                    <Countdown to={a.pickupDeadline} />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </FieldSet>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Plan date" error={issues.planDate} required>
          <Input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
        </Field>
        <Field label="Start time (IST)" error={issues.startTime} required>
          <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label="Vehicle capacity (units)" error={issues.capacity} hint={profile.defaultVehicleCapacity ? `Profile default: ${profile.defaultVehicleCapacity}` : 'Set a default in your profile'} required={!profile.defaultVehicleCapacity}>
          <Input type="number" inputMode="numeric" min={1} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label="Representative" hint="Optional">
          <Select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            options={[{ value: '', label: reps.isPending ? 'Loading…' : 'Not decided' }, ...(reps.data ?? []).filter((r) => r.status === 'ACTIVE').map((r) => ({ value: r.id, label: r.fullName }))]}
          />
        </Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {profile.location ? <Checkbox checked={customStart} onChange={(e) => setCustomStart(e.target.checked)} label="Start somewhere other than the NGO" /> : <p className="text-sm text-amber-300">Your NGO has no location: choose a start point.</p>}
          {customStart ? <LocationPicker value={start} onChange={setStart} label="Start point" height={200} /> : null}
          {issues.start ? <p className="text-xs text-red-300">{issues.start}</p> : null}
        </div>
        <div className="space-y-2">
          {profile.location ? <Checkbox checked={customEnd} onChange={(e) => setCustomEnd(e.target.checked)} label="End somewhere other than the NGO" /> : <p className="text-sm text-amber-300">Choose an end point.</p>}
          {customEnd || !profile.location ? <LocationPicker value={end} onChange={setEnd} label="End point" height={200} /> : null}
          {issues.end ? <p className="text-xs text-red-300">{issues.end}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} loading={create.isPending} disabled={!valid} leftIcon={<Wand2 className="size-4" aria-hidden="true" />}>
          Plan the route
        </Button>
        {!valid && selected.length === 0 ? <span className="text-xs text-slate-400">{issues.selected}</span> : null}
      </div>
    </div>
  );
}
