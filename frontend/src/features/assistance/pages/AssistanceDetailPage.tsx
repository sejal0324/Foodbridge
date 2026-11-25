import { CalendarClock, HandHeart, MapPin, Users } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { MapView } from '@/components/map';
import { Banner, Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, DistanceLabel, EmptyState, ErrorState, LoadingState, PageHeader, ProgressBar, StatusBadge, useToast } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { useNow } from '@/hooks/useNow';
import { ApprovalGate } from '@/features/profile/components/VerificationBanner';
import type { AssistanceRequestDetail } from '@/types';
import { formatNumber, formatQuantity, formatRelative, formatWindow } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useAssistanceRequest, useRespondToRequest } from '../api';
import { UrgencyBadge } from '../components/AssistanceRequestCard';
import { OfferActions } from '../components/OfferActions';
import { OfferFormDialog } from '../components/OfferFormDialog';

const ACTIVE_OFFER = ['PROPOSED', 'ACCEPTED', 'RESERVED', 'PICKUP_ASSIGNED'];

export default function AssistanceDetailPage() {
  const user = useCurrentUser();
  const { id } = useParams<{ id: string }>();
  return (
    <ApprovalGate user={user} feature="NGO requests">
      <AssistanceDetail id={id as string} />
    </ApprovalGate>
  );
}

function AssistanceDetail({ id }: { id: string }) {
  const query = useAssistanceRequest(id);
  const [offering, setOffering] = useState(false);
  const [responding, setResponding] = useState<'DECLINED' | 'UNAVAILABLE' | null>(null);
  const now = useNow(60_000);
  if (query.isPending) return <LoadingState label="Loading request…" />;
  if (query.isError) return <ErrorState error={query.error} title="This request could not be loaded" onRetry={() => void query.refetch()} />;
  const r = query.data;
  const open = ['OPEN', 'PARTIALLY_FULFILLED'].includes(r.status) && Date.parse(r.neededUntil) > now;
  const activeOffer = r.offers.find((o) => ACTIVE_OFFER.includes(o.status));

  return (
    <>
      <PageHeader
        title={`${r.ngo.name} needs ${formatQuantity(r.quantityRemaining, r.unit)}`}
        description={`${r.category.name} · ${DIETARY_LABELS[r.dietaryRequirement]}`}
        back={{ to: '/donor/assistance', label: 'NGO requests' }}
        meta={
          <>
            <StatusBadge status={r.status} />
            <UrgencyBadge urgency={r.urgency} />
          </>
        }
        actions={
          open && !activeOffer ? (
            <>
              <Button variant="ghost" onClick={() => setResponding('DECLINED')}>
                Decline
              </Button>
              <Button variant="outline" onClick={() => setResponding('UNAVAILABLE')}>
                I’m unavailable
              </Button>
              <Button leftIcon={<HandHeart className="size-4" aria-hidden="true" />} onClick={() => setOffering(true)}>
                Offer food
              </Button>
            </>
          ) : null
        }
      />
      {!open && !activeOffer ? (
        <Banner tone="info" className="mb-6">
          This request is no longer open for new offers.
        </Banner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your offers" description="Only your own offers are shown." />
            <CardBody>
              {r.offers.length === 0 ? (
                <EmptyState
                  compact
                  title="No offer yet"
                  description={open ? 'Offer the full quantity or part of it. Several donors can each cover part of the need.' : undefined}
                  action={
                    open ? (
                      <Button size="sm" onClick={() => setOffering(true)}>
                        Offer food
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <ul className="divide-y divide-white/5">
                  {r.offers.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">{o.foodName}</p>
                          <StatusBadge status={o.status} />
                          {o.readyNow ? <span className="text-xs text-emerald-300">Ready now</span> : null}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-300">
                          Offered {formatQuantity(o.offeredQuantity, r.unit)}
                          {o.acceptedQuantity !== null ? ` · accepted ${o.acceptedQuantity}` : ''}
                          {o.confirmedQuantity !== null ? ` · confirmed ${o.confirmedQuantity}` : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Pickup {formatWindow(o.pickupAvailableFrom, o.pickupDeadline)} · {formatRelative(o.createdAt)}
                        </p>
                        {o.rejectionReason ? <p className="mt-1 text-xs text-slate-400">NGO’s reason: {o.rejectionReason}</p> : null}
                        {o.cancelReason ? <p className="mt-1 text-xs text-slate-400">Withdrawn: {o.cancelReason}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {o.donationId ? (
                          <ButtonLink to={`/donor/donations/${o.donationId}`} size="sm" variant="outline">
                            View reservation
                          </ButtonLink>
                        ) : null}
                        <OfferActions offer={o} unit={r.unit} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <RequestFacts r={r} />
        </div>
        <aside>
          <Card>
            <CardHeader title="Delivery location" as="h3" icon={<MapPin className="size-4" aria-hidden="true" />} />
            <CardBody className="space-y-3">
              <MapView ariaLabel={`Location of ${r.ngo.name}'s request`} markers={[{ id: 'ngo', position: r.location, kind: 'ngo', label: 'N', title: r.address }]} height={240} />
              <p className="text-sm text-slate-300">{r.address}</p>
              {r.distanceKm !== undefined ? <DistanceLabel km={r.distanceKm} source={r.distanceSource} /> : null}
            </CardBody>
          </Card>
        </aside>
      </div>

      {offering ? <OfferFormDialog request={r} onClose={() => setOffering(false)} /> : null}
      {responding ? <RespondDialog requestId={r.id} response={responding} ngoName={r.ngo.name} onClose={() => setResponding(null)} /> : null}
    </>
  );
}

function RequestFacts({ r }: { r: AssistanceRequestDetail }) {
  return (
    <Card>
      <CardHeader title="Request details" as="h3" />
      <CardBody className="space-y-5">
        <div>
          <ProgressBar value={r.quantityCommitted} max={r.quantityRequired} label="Share already committed by donors" tone="info" />
          <p className="mt-1 text-xs text-slate-400">
            {formatNumber(r.quantityCommitted)} of {formatQuantity(r.quantityRequired, r.unit)} committed · {formatQuantity(r.quantityRemaining, r.unit)} still needed
          </p>
        </div>
        <DescriptionList
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
            { term: 'Category', description: r.category.name },
            ...(r.reason ? [{ term: 'Why', description: r.reason }] : []),
            ...(r.additionalRequirements ? [{ term: 'Additional requirements', description: r.additionalRequirements }] : []),
          ]}
        />
      </CardBody>
    </Card>
  );
}

function RespondDialog({ requestId, response, ngoName, onClose }: { requestId: string; response: 'DECLINED' | 'UNAVAILABLE'; ngoName: string; onClose: () => void }) {
  const respond = useRespondToRequest();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={response === 'DECLINED' ? 'Decline this request?' : 'Mark yourself unavailable?'}
      description={
        response === 'DECLINED'
          ? `${ngoName} will not be waiting on you for this request. You can still offer later while it is open.`
          : `This tells FoodBridge you cannot help with this request, so ${ngoName} looks elsewhere. To pause all requests, use “Pause availability” in your profile.`
      }
      confirmLabel={response === 'DECLINED' ? 'Decline' : 'Mark unavailable'}
      loading={respond.isPending}
      onConfirm={() =>
        respond
          .mutateAsync({ requestId, response })
          .then((r) => {
            toast.success(r.updated > 0 ? 'Response recorded' : 'Noted', r.updated > 0 ? undefined : 'You were not on this request’s recommendation list, so nothing changed.');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    />
  );
}
