import { CalendarClock, HandHeart, MapPin, Pencil, Users, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { MapView, type MapMarker } from '@/components/map';
import { Badge, Banner, Button, ButtonLink, Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui';
import { useAssistanceRequest } from '@/features/assistance/api';
import { UrgencyBadge } from '@/features/assistance/components/AssistanceRequestCard';
import { useNow } from '@/hooks/useNow';
import type { AssistanceRequestDetail, Offer } from '@/types';
import { formatNumber, formatQuantity, formatRelative, formatWindow } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { AllocationSuggestion } from '../components/AllocationSuggestion';
import { CancelAssistanceDialog, EditAssistanceDialog } from '../components/AssistanceDialogs';
import { AssistanceProgress, OfferTimeline } from '../components/common';
import { AcceptOfferDialog, RejectOfferDialog } from '../components/OfferDialogs';
import { RecommendedDonorsCard } from '../components/RecommendedDonorsCard';

const EDITABLE = ['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED'];
const ACCEPTING = ['OPEN', 'PARTIALLY_FULFILLED'];

export default function AssistanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useAssistanceRequest(id);
  if (query.isPending) return <LoadingState label="Loading request…" />;
  if (query.isError) return <ErrorState error={query.error} title="This request could not be loaded" onRetry={() => void query.refetch()} />;
  return <AssistanceDetail r={query.data} reload={async () => (await query.refetch()).data} />;
}

function AssistanceDetail({ r, reload }: { r: AssistanceRequestDetail; reload: () => Promise<AssistanceRequestDetail | undefined> }) {
  const now = useNow(60_000);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [accepting, setAccepting] = useState<Offer | null>(null);
  const [rejecting, setRejecting] = useState<Offer | null>(null);
  const editable = EDITABLE.includes(r.status);
  const canAccept = ACCEPTING.includes(r.status) && r.quantityRemaining > 0 && Date.parse(r.neededUntil) > now;
  const proposed = r.offers.filter((o) => o.status === 'PROPOSED');
  const offers = [...r.offers].sort((a, b) => Number(b.status === 'PROPOSED') - Number(a.status === 'PROPOSED') || Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const markers = useMemo<MapMarker[]>(
    () => [
      { id: 'ngo', position: r.location, kind: 'ngo', label: 'N', title: `Delivery: ${r.address}` },
      ...r.offers.filter((o) => ['PROPOSED', 'ACCEPTED', 'RESERVED', 'PICKUP_ASSIGNED'].includes(o.status)).map((o): MapMarker => ({ id: o.id, position: o.location, kind: 'donor', label: 'D', title: `${o.donor.name}: ${o.address}` })),
    ],
    [r.location, r.address, r.offers],
  );

  return (
    <>
      <PageHeader
        title={`${formatQuantity(r.quantityRequired, r.unit)} · ${r.category.name}`}
        description={`${DIETARY_LABELS[r.dietaryRequirement]} · needed ${formatWindow(r.neededFrom, r.neededUntil)}`}
        back={{ to: '/ngo/assistance', label: 'Assistance requests' }}
        meta={
          <>
            <StatusBadge status={r.status} />
            <UrgencyBadge urgency={r.urgency} />
          </>
        }
        actions={
          editable ? (
            <>
              <Button variant="outline" leftIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="ghost" leftIcon={<XCircle className="size-4" aria-hidden="true" />} onClick={() => setCancelling(true)}>
                Cancel request
              </Button>
            </>
          ) : null
        }
      />
      {r.status === 'EXPIRED' ? <Banner className="mb-6">This request expired at the end of its time window.</Banner> : null}
      {r.status === 'CANCELLED' ? <Banner className="mb-6">This request was cancelled.</Banner> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Progress" as="h3" />
            <CardBody>
              <AssistanceProgress request={r} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Offers from donors" description={proposed.length > 0 ? `${proposed.length} waiting for your decision` : 'Donors offer all or part of what you need'} icon={<HandHeart className="size-4" aria-hidden="true" />} />
            <CardBody>
              {offers.length === 0 ? (
                <EmptyState compact title="No offers yet" description="Recommended donors are notified automatically. Offers appear here as soon as they arrive." />
              ) : (
                <ul className="divide-y divide-white/5">
                  {offers.map((o) => (
                    <OfferRow key={o.id} offer={o} unit={r.unit} canAccept={canAccept} onAccept={() => setAccepting(o)} onReject={() => setRejecting(o)} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Stays mounted after applying, so the per-offer results remain visible once the offers are no longer PROPOSED. */}
          {r.offers.length > 0 ? <AllocationSuggestion requestId={r.id} offers={r.offers} unit={r.unit} canAccept={canAccept} hasProposed={proposed.length > 0} /> : null}

          <RecommendedDonorsCard requestId={r.id} open={ACCEPTING.includes(r.status)} />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Delivery location" as="h3" icon={<MapPin className="size-4" aria-hidden="true" />} description="N is your delivery point; D are active offers." />
            <CardBody className="space-y-3">
              <MapView ariaLabel="Delivery location and the pickup points of active offers" markers={markers} fitToContent height={240} />
              <p className="text-sm text-slate-300">{r.address}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" as="h3" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  {
                    term: 'Needed',
                    description: (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-4 text-slate-500" aria-hidden="true" />
                        {formatWindow(r.neededFrom, r.neededUntil)}
                      </span>
                    ),
                  },
                  {
                    term: 'People served',
                    description: (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-4 text-slate-500" aria-hidden="true" />
                        {formatNumber(r.beneficiariesCount)}
                      </span>
                    ),
                  },
                  { term: 'Diet', description: DIETARY_LABELS[r.dietaryRequirement] },
                  { term: 'Created', description: formatRelative(r.createdAt) },
                  ...(r.reason ? [{ term: 'Why', description: r.reason }] : []),
                  ...(r.additionalRequirements ? [{ term: 'Additional requirements', description: r.additionalRequirements }] : []),
                ]}
              />
            </CardBody>
          </Card>
        </aside>
      </div>

      {editing ? <EditAssistanceDialog request={r} onReload={reload} onClose={() => setEditing(false)} /> : null}
      {cancelling ? <CancelAssistanceDialog request={r} onClose={() => setCancelling(false)} /> : null}
      {accepting ? <AcceptOfferDialog offer={accepting} unit={r.unit} remaining={r.quantityRemaining} onClose={() => setAccepting(null)} /> : null}
      {rejecting ? <RejectOfferDialog offer={rejecting} onClose={() => setRejecting(null)} /> : null}
    </>
  );
}

function OfferRow({ offer: o, unit, canAccept, onAccept, onReject }: { offer: Offer; unit: AssistanceRequestDetail['unit']; canAccept: boolean; onAccept: () => void; onReject: () => void }) {
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{o.donor.name}</p>
            <StatusBadge status={o.status} />
            {o.readyNow ? (
              <Badge tone="success" title="Food already prepared: accepting reserves it immediately">
                Ready now
              </Badge>
            ) : (
              <Badge tone="neutral" title="The donor confirms the actual food when it is ready">
                Prepared later
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-300">
            {o.foodName} · {DIETARY_LABELS[o.dietaryType]} · offered {formatQuantity(o.offeredQuantity, unit)}
            {o.acceptedQuantity !== null ? ` · accepted ${formatNumber(o.acceptedQuantity)}` : ''}
            {o.confirmedQuantity !== null ? ` · confirmed ${formatNumber(o.confirmedQuantity)}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Pickup {formatWindow(o.pickupAvailableFrom, o.pickupDeadline)} · {o.address} · {formatRelative(o.createdAt)}
          </p>
          {o.notes ? <p className="mt-1 text-xs text-slate-400">Donor’s note: {o.notes}</p> : null}
          {o.rejectionReason ? <p className="mt-1 text-xs text-slate-400">Your reason: {o.rejectionReason}</p> : null}
          {o.cancelReason ? <p className="mt-1 text-xs text-slate-400">Withdrawn by the donor: {o.cancelReason}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {o.status === 'PROPOSED' && canAccept ? (
            <>
              <Button size="sm" onClick={onAccept}>
                Accept…
              </Button>
              <Button size="sm" variant="ghost" onClick={onReject}>
                Decline
              </Button>
            </>
          ) : null}
          {o.allocationId && ['RESERVED', 'PICKUP_ASSIGNED'].includes(o.status) ? (
            <ButtonLink to="/ngo/collections" size="sm" variant="outline">
              {o.status === 'RESERVED' ? 'Assign pickup' : 'Collection'}
            </ButtonLink>
          ) : null}
        </div>
      </div>
      <OfferTimeline status={o.status} />
    </li>
  );
}
