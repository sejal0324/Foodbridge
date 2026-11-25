import { HandHeart, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { ButtonLink, Card, EmptyState, Field, PageHeader, Pagination, Select, StatusBadge, TabPanel, Tabs } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { RecommendationCard, useRecommendedAssistanceRequests } from '@/features/matching';
import { ApprovalGate } from '@/features/profile/components/VerificationBanner';
import { formatQuantity, formatRelative, formatWindow } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useAssistanceRequests, useMyOffers } from '../api';
import { AssistanceRequestCard, UrgencyBadge } from '../components/AssistanceRequestCard';
import { OfferActions } from '../components/OfferActions';

type Tab = 'recommended' | 'open' | 'offers';
const TABS: { value: Tab; label: string }[] = [
  { value: 'recommended', label: 'Recommended for you' },
  { value: 'open', label: 'All open requests' },
  { value: 'offers', label: 'My offers' },
];
const DISTANCES = [5, 10, 25, 50, 100];

export default function DonorAssistancePage() {
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'recommended') as Tab;
  return (
    <>
      <PageHeader title="NGO requests" description="Food that NGOs need. Offer a full or partial quantity; the NGO decides which offers to accept." />
      <ApprovalGate user={user} feature="Responding to NGO requests">
        <Card>
          <div className="px-5 pt-3">
            <Tabs idPrefix="assist" label="NGO request views" value={tab} onChange={(v) => setParams(v === 'recommended' ? {} : { tab: v }, { replace: true })} items={TABS} />
          </div>
          <TabPanel value={tab} idPrefix="assist" className="p-5 focus:outline-none">
            {tab === 'recommended' ? <RecommendedTab /> : tab === 'open' ? <OpenTab /> : <OffersTab />}
          </TabPanel>
        </Card>
      </ApprovalGate>
    </>
  );
}

function RecommendedTab() {
  const query = useRecommendedAssistanceRequests();
  return (
    <QueryState
      query={query}
      empty={
        <EmptyState
          icon={<Sparkles className="size-6" aria-hidden="true" />}
          title="No recommendations right now"
          description="When an NGO near you needs food you usually have, it appears here. You can also browse all open requests."
        />
      }
    >
      {(items) => (
        <div className="space-y-3">
          {items.map((r) => (
            <RecommendationCard
              key={r.request.id}
              title={`${r.request.ngoName} needs ${formatQuantity(r.request.quantityRemaining, r.request.unit)}`}
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {r.request.categoryName} · {DIETARY_LABELS[r.request.dietaryRequirement]} · {formatWindow(r.request.neededFrom, r.request.neededUntil)}
                  </span>
                  <UrgencyBadge urgency={r.request.urgency} />
                </span>
              }
              score={r.score}
              explanation={r.explanation}
              limitations={r.limitations}
              criteria={r.criteria}
              distanceKm={r.distanceKm}
              distanceSource={r.distanceSource}
              rankingStatus={r.rankingStatus}
              response={r.response}
              actions={
                <ButtonLink to={`/donor/assistance/${r.request.id}`} size="sm">
                  {r.response === 'OFFERED' ? 'View my offer' : 'View & respond'}
                </ButtonLink>
              }
            />
          ))}
        </div>
      )}
    </QueryState>
  );
}

function OpenTab() {
  const [radius, setRadius] = useState(25);
  const [page, setPage] = useState(1);
  // maxDistanceKm is always sent: it also sorts by distance from your location.
  const query = useAssistanceRequests({ page, scope: 'open', maxDistanceKm: radius });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Within" className="w-40">
          <Select
            value={String(radius)}
            onChange={(e) => {
              setRadius(Number(e.target.value));
              setPage(1);
            }}
            options={DISTANCES.map((d) => ({ value: String(d), label: `${d} km` }))}
          />
        </Field>
        <p className="text-xs text-slate-500">Distances are straight-line estimates from your profile location.</p>
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState icon={<HandHeart className="size-6" aria-hidden="true" />} title="No open requests in this range" description="Try a larger distance, or check back later." />}
      >
        {(data) => (
          <>
            <div className="space-y-3">
              {data.items.map((r) => (
                <AssistanceRequestCard key={r.id} request={r} to={`/donor/assistance/${r.id}`} />
              ))}
            </div>
            <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function OffersTab() {
  const query = useMyOffers();
  return (
    <QueryState query={query} empty={<EmptyState icon={<HandHeart className="size-6" aria-hidden="true" />} title="You have not made any offers yet" description="Offer food from the recommended or open requests." />}>
      {(offers) => (
        <ul className="divide-y divide-white/5">
          {offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/donor/assistance/${o.assistanceRequestId}`} className="text-sm font-medium text-white hover:underline">
                    {o.foodName} for {o.ngoName}
                  </Link>
                  <StatusBadge status={o.status} />
                </div>
                <p className="mt-0.5 text-sm text-slate-300">
                  Offered {formatQuantity(o.offeredQuantity, o.unit)}
                  {o.acceptedQuantity !== null ? ` · accepted ${o.acceptedQuantity}` : ''}
                  {o.confirmedQuantity !== null ? ` · confirmed ${o.confirmedQuantity}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pickup {formatWindow(o.pickupAvailableFrom, o.pickupDeadline)} · sent {formatRelative(o.createdAt)}
                </p>
                {o.status === 'ACCEPTED' ? <p className="mt-1 text-xs text-amber-300">Accepted: confirm the actual quantity when the food is ready.</p> : null}
                {o.rejectionReason ? <p className="mt-1 text-xs text-slate-400">NGO’s reason: {o.rejectionReason}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {o.donationId ? (
                  <ButtonLink to={`/donor/donations/${o.donationId}`} size="sm" variant="outline">
                    View reservation
                  </ButtonLink>
                ) : null}
                <OfferActions offer={o} unit={o.unit} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}
