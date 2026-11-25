import { Flag, MapPin, UserRoundCog } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { MapView, type MapMarker } from '@/components/map';
import { Banner, Button, ButtonLink, Card, CardBody, CardHeader, Countdown, DescriptionList, ErrorState, LoadingState, PageHeader, QuantityBadge, StatusBadge } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { RepresentativeCard } from '@/features/pickups';
import { TrackingViewer } from '@/features/tracking';
import type { PickupDetail } from '@/types';
import { formatDateTime, formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { isNgoOwner } from '../access';
import { useNgoPickup } from '../api';
import { DeliveryCard, NgoHandoverCard, ReportFailureDialog, VerificationChecks } from '../components/HandoverCards';
import { LocationSharingCard } from '../components/LocationSharingCard';
import { PickupPassCard } from '../components/PickupPassCard';
import { trackingStageFor } from '../utils';

const LIVE_STATUSES = ['ASSIGNED', 'EN_ROUTE', 'VERIFIED', 'HANDED_OVER', 'IN_TRANSIT'];

export default function PickupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useNgoPickup(id);
  if (query.isPending) return <LoadingState label="Loading pickup…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} title="This pickup could not be loaded" />;
  return <PickupView p={query.data} />;
}

function PickupView({ p }: { p: PickupDetail }) {
  const user = useCurrentUser();
  const owner = isNgoOwner(user);
  const isRep = p.viewer === 'REPRESENTATIVE';
  const [reportOpen, setReportOpen] = useState(false);
  const stage = trackingStageFor(p.status);
  const canReport = ['ASSIGNED', 'EN_ROUTE', 'VERIFIED'].includes(p.status);
  const activeSession = p.trackingSessions.find((s) => s.status === 'ACTIVE');
  const viewerSession = activeSession ?? p.trackingSessions[p.trackingSessions.length - 1];
  const destination = p.destination?.location ?? null;

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [{ id: 'pickup', position: p.donation.location, kind: 'pickup', label: 'P', title: `Pickup: ${p.donation.address}` }];
    if (destination) out.push({ id: 'dest', position: destination, kind: 'destination', label: 'D', title: `Destination: ${p.destination?.address ?? ''}` });
    return out;
  }, [p.donation.location, p.donation.address, destination, p.destination?.address]);

  return (
    <>
      <PageHeader
        title={p.donation.foodName}
        description={`From ${p.donor.name} · collected by ${isRep ? 'you' : p.representative.name}`}
        back={{ to: '/ngo/pickups', label: isRep && !owner ? 'My pickups' : 'Pickups' }}
        meta={
          <>
            <StatusBadge status={p.status} />
            <QuantityBadge quantity={p.donation.quantity} unit={p.donation.unit} />
            {['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? <Countdown to={p.donation.pickupDeadline} /> : null}
          </>
        }
        actions={
          <>
            {owner && ['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? (
              <ButtonLink to="/ngo/collections?tab=PICKUP_ASSIGNED" variant="outline" leftIcon={<UserRoundCog className="size-4" aria-hidden="true" />}>
                Reassign
              </ButtonLink>
            ) : null}
            {canReport ? (
              <Button variant="ghost" leftIcon={<Flag className="size-4" aria-hidden="true" />} onClick={() => setReportOpen(true)}>
                Report a problem
              </Button>
            ) : null}
          </>
        }
      />

      {p.status === 'DISPUTED' ? (
        <Banner tone="danger" title="This pickup is disputed" className="mb-6">
          The donor and your NGO confirmed different quantities. FoodBridge administrators are reviewing it; no points or fees are recorded until it is resolved.
        </Banner>
      ) : null}
      {p.status === 'FAILED' || p.status === 'CANCELLED' ? (
        <Banner tone="warning" title={p.status === 'FAILED' ? 'This pickup failed' : 'This pickup was cancelled'} className="mb-6">
          {p.cancelReason ? `Reason: ${p.cancelReason}. ` : ''}
          {owner && p.allocationStatus === 'RESERVED' ? 'The food is still reserved for your NGO: assign someone else from Collections.' : null}
        </Banner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {isRep && ['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? <PickupPassCard pickup={p} /> : null}
          {isRep && stage ? <LocationSharingCard key={`${p.id}-${stage}`} pickup={p} stage={stage} /> : null}
          <NgoHandoverCard pickup={p} showBillingLink={owner} />
          <DeliveryCard pickup={p} />
          {viewerSession ? (
            <TrackingViewer
              key={`${viewerSession.id}-${viewerSession.status}-${p.status}`}
              sessionId={viewerSession.id}
              destinationLabel={viewerSession.stage === 'TO_PICKUP' ? 'Pickup point' : 'Destination'}
              fallbackDestination={viewerSession.stage === 'TO_PICKUP' ? p.donation.location : destination}
            />
          ) : (
            <Card>
              <CardHeader title="Pickup point" icon={<MapPin className="size-4" aria-hidden="true" />} description={LIVE_STATUSES.includes(p.status) ? 'Location sharing has not been started for this pickup.' : undefined} />
              <CardBody>
                <MapView ariaLabel="Pickup point and destination" markers={markers} fitToContent height={240} />
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Pickup details" as="h3" />
            <CardBody className="space-y-4">
              <DescriptionList
                columns={1}
                items={[
                  { term: 'Food', description: `${p.donation.foodName} · ${DIETARY_LABELS[p.donation.dietaryType]}` },
                  { term: 'Reserved quantity', description: formatQuantity(p.donation.quantity, p.donation.unit) },
                  { term: 'Donor', description: p.donor.name },
                  { term: 'Pickup address', description: p.donation.address },
                  { term: 'Pickup deadline', description: formatDateTime(p.donation.pickupDeadline) },
                  { term: 'Scheduled', description: p.scheduledPickupAt ? formatDateTime(p.scheduledPickupAt) : 'Not scheduled' },
                  { term: 'Destination', description: p.destination?.address ?? `${p.ngo.name} (NGO location)` },
                  ...(p.handedOverAt ? [{ term: 'Handed over', description: formatDateTime(p.handedOverAt) }] : []),
                  ...(p.deliveredAt ? [{ term: 'Delivered', description: formatDateTime(p.deliveredAt) }] : []),
                ]}
              />
              <div>
                <p className="mb-2 text-sm font-medium text-white">Verification by the donor</p>
                <VerificationChecks checks={p.checks} />
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={isRep ? 'Your representative details' : 'Representative'} as="h3" description={isRep ? 'This is what the donor sees when checking you.' : undefined} />
            <CardBody>
              <RepresentativeCard rep={p.representative} ngoName={p.ngo.name} />
            </CardBody>
          </Card>
        </aside>
      </div>

      <ReportFailureDialog pickupId={p.id} open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
