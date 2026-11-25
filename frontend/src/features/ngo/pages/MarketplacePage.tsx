import { List, Map as MapIcon, Sparkles, Store } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { MapView, type MapMarker } from '@/components/map';
import { Banner, Button, ButtonLink, Card, CardBody, CardHeader, Countdown, DistanceLabel, EmptyState, Field, PageHeader, Pagination, QuantityBadge, Select, SkeletonList } from '@/components/ui';
import { DonationCard } from '@/features/donations';
import { useFoodCategories } from '@/features/donations/api';
import { RecommendationCard, useRecommendedDonations } from '@/features/matching';
import { DIETARY_TYPES, type DietaryType, type Donation } from '@/types';
import { cn } from '@/utils/cn';
import { formatNumber, formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useMarketplace, useNgoProfile, type MarketplaceParams } from '../api';

const PAGE_SIZE = 12;
const MAP_PAGE_SIZE = 100;
const DISTANCES = [5, 10, 25, 50, 100];
const SORTS: { value: MarketplaceParams['sort']; label: string }[] = [
  { value: 'distance', label: 'Nearest first' },
  { value: 'deadline', label: 'Pickup deadline (soonest)' },
  { value: 'newest', label: 'Newest first' },
];

/** Reads the marketplace filters from the URL (so the back button keeps them). */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const sort = (SORTS.find((s) => s.value === params.get('sort'))?.value ?? 'distance') as MarketplaceParams['sort'];
  const diet = DIETARY_TYPES.find((d) => d === params.get('diet'));
  const category = params.get('category') ?? '';
  const within = params.get('within') ?? 'radius';
  const view = params.get('view') === 'map' ? 'map' : 'list';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage && !('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return { sort, diet, category, within, view, page, set };
}

export default function MarketplacePage() {
  const f = useFilters();
  const profile = useNgoProfile();
  const categories = useFoodCategories();
  const radius = profile.data?.collectionRadiusKm;
  const hasLocation = Boolean(profile.data?.location);
  const maxDistanceKm = f.within === 'any' ? undefined : f.within === 'radius' ? radius : Number(f.within) || undefined;
  const params: MarketplaceParams = {
    page: f.view === 'map' ? 1 : f.page,
    pageSize: f.view === 'map' ? MAP_PAGE_SIZE : PAGE_SIZE,
    sort: f.sort,
    dietaryType: f.diet as DietaryType | undefined,
    categoryId: f.category || undefined,
    maxDistanceKm: hasLocation ? maxDistanceKm : undefined,
  };
  // Wait for the profile so the default "within my radius" filter is applied from the first request.
  const query = useMarketplace(params, !profile.isPending);

  return (
    <>
      <PageHeader
        title="Marketplace"
        description="Surplus food listed by verified donors. Request what you can collect before the pickup deadline; you pay a service fee only for food actually handed over."
        actions={
          <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="View">
            <Button size="sm" variant={f.view === 'list' ? 'secondary' : 'ghost'} aria-pressed={f.view === 'list'} leftIcon={<List className="size-4" aria-hidden="true" />} onClick={() => f.set({ view: null }, false)}>
              List
            </Button>
            <Button size="sm" variant={f.view === 'map' ? 'secondary' : 'ghost'} aria-pressed={f.view === 'map'} leftIcon={<MapIcon className="size-4" aria-hidden="true" />} onClick={() => f.set({ view: 'map' }, false)}>
              Map
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {f.view === 'list' && f.page === 1 ? <RecommendedSection /> : null}

        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Diet">
              <Select value={f.diet ?? ''} onChange={(e) => f.set({ diet: e.target.value || null })} options={[{ value: '', label: 'Any diet' }, ...DIETARY_TYPES.map((d) => ({ value: d, label: DIETARY_LABELS[d] }))]} />
            </Field>
            <Field label="Category">
              <Select
                value={f.category}
                onChange={(e) => f.set({ category: e.target.value || null })}
                options={[{ value: '', label: categories.isPending ? 'Loading…' : 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Field>
            <Field label="Distance" hint={hasLocation ? 'Straight-line distance from your NGO' : 'Set your NGO location in the profile to filter by distance'}>
              <Select
                value={f.within}
                disabled={!hasLocation}
                onChange={(e) => f.set({ within: e.target.value === 'radius' ? null : e.target.value })}
                options={[
                  { value: 'radius', label: radius ? `My collection radius (${formatNumber(radius)} km)` : 'My collection radius' },
                  ...DISTANCES.map((d) => ({ value: String(d), label: `Within ${d} km` })),
                  { value: 'any', label: 'Anywhere in India' },
                ]}
              />
            </Field>
            <Field label="Sort by">
              <Select value={f.sort} onChange={(e) => f.set({ sort: e.target.value === 'distance' ? null : e.target.value })} options={SORTS.map((s) => ({ value: s.value, label: s.label }))} />
            </Field>
          </CardBody>
        </Card>

        {profile.isSuccess && !hasLocation ? (
          <Banner tone="warning" title="Your NGO has no location yet">
            Distances and the nearest-first order need your location. <Link to="/ngo/profile" className="font-medium underline">Set it in your profile</Link>.
          </Banner>
        ) : null}

        {f.view === 'map' ? (
          <MarketplaceMap query={query} ngoLocation={profile.data?.location ?? null} ngoName={profile.data?.organizationName} />
        ) : (
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={<NoResults within={f.within} onWiden={() => f.set({ within: 'any' })} />}
          >
            {(data) => (
              <>
                <p className="mb-3 text-sm text-slate-400" aria-live="polite">
                  {formatNumber(data.meta.total)} donation{data.meta.total === 1 ? '' : 's'} available
                </p>
                <ul className={cn('grid gap-3 lg:grid-cols-2', query.isPlaceholderData && 'opacity-60')}>
                  {data.items.map((d) => (
                    <li key={d.id}>
                      <DonationCard
                        donation={d}
                        to={`/ngo/marketplace/${d.id}`}
                        showDonor
                        actions={
                          <ButtonLink to={`/ngo/marketplace/${d.id}`} size="sm">
                            View & request
                          </ButtonLink>
                        }
                      />
                    </li>
                  ))}
                </ul>
                <Pagination className="mt-4" page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => f.set({ page: p === 1 ? null : String(p) }, false)} />
              </>
            )}
          </QueryState>
        )}
      </div>
    </>
  );
}

function NoResults({ within, onWiden }: { within: string; onWiden: () => void }) {
  return (
    <EmptyState
      icon={<Store className="size-6" aria-hidden="true" />}
      title="No donations match these filters"
      description={within === 'any' ? 'Nothing is listed right now. New donations appear here as soon as donors publish them.' : 'Nothing is listed within this distance right now.'}
      action={
        within !== 'any' ? (
          <Button size="sm" variant="outline" onClick={onWiden}>
            Show all of India
          </Button>
        ) : null
      }
    />
  );
}

function RecommendedSection() {
  const query = useRecommendedDonations();
  if (query.isError || (query.isSuccess && query.data.length === 0)) return null;
  return (
    <Card>
      <CardHeader title="Recommended for you" description="Ranked for your needs, capacity, food preferences and collection radius" icon={<Sparkles className="size-4" aria-hidden="true" />} />
      <CardBody>
        {query.isPending ? (
          <SkeletonList rows={2} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {query.data.slice(0, 4).map((r) => (
              <RecommendationCard
                key={r.donation.id}
                title={r.donation.foodName}
                subtitle={`${r.donation.donorName} · ${formatQuantity(r.donation.availableQuantity, r.donation.unit)} · ${DIETARY_LABELS[r.donation.dietaryType]}`}
                score={r.score}
                explanation={r.explanation}
                limitations={r.limitations}
                criteria={r.criteria}
                distanceKm={r.distanceKm}
                distanceSource={r.distanceSource}
                rankingStatus={r.rankingStatus}
                actions={
                  <ButtonLink to={`/ngo/marketplace/${r.donation.id}`} size="sm">
                    View & request
                  </ButtonLink>
                }
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MarketplaceMap({
  query,
  ngoLocation,
  ngoName,
}: {
  query: ReturnType<typeof useMarketplace>;
  ngoLocation: { lat: number; lng: number } | null;
  ngoName?: string;
}) {
  const items = useMemo(() => (query.data?.items ?? []).filter((d): d is Donation & { location: { lat: number; lng: number } } => d.location !== null), [query.data]);
  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = items.map((d, i) => ({ id: d.id, position: d.location, kind: 'donor', label: String(i + 1), title: `${i + 1}. ${d.foodName} — ${formatQuantity(d.availableQuantity, d.unit)} (${d.donor.name})` }));
    if (ngoLocation) out.push({ id: 'ngo', position: ngoLocation, kind: 'ngo', label: 'N', title: ngoName ? `${ngoName} (you)` : 'Your NGO' });
    return out;
  }, [items, ngoLocation, ngoName]);
  const total = query.data?.meta.total ?? 0;

  return (
    <Card>
      <CardHeader
        title="Donations on the map"
        description={query.data ? `${formatNumber(items.length)} of ${formatNumber(total)} shown${total > MAP_PAGE_SIZE ? ' (narrow the filters to see the rest)' : ''}. N marks your NGO.` : 'Loading…'}
        icon={<MapIcon className="size-4" aria-hidden="true" />}
      />
      <CardBody className="space-y-4">
        <MapView ariaLabel={`Map of ${items.length} available donations${ngoLocation ? ' and your NGO' : ''}`} markers={markers} fitToContent height={420} />
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title="No donations match these filters" />}>
          {() => (
            <ol className="grid gap-2 sm:grid-cols-2">
              {items.map((d, i) => (
                <li key={d.id} className="flex items-start gap-3 rounded-lg border border-white/10 p-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-white" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/ngo/marketplace/${d.id}`} className="text-sm font-medium text-white hover:underline">
                      {d.foodName}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {d.donor.name} · {d.address}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <QuantityBadge quantity={d.availableQuantity} unit={d.unit} muted />
                      <DistanceLabel km={d.distanceKm} source={d.distanceSource} className="text-xs" />
                      <Countdown to={d.pickupDeadline} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
