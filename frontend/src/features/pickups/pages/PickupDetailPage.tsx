import { Flag } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MapView } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, Countdown, DescriptionList, ErrorState, Field, LoadingState, PageHeader, QuantityBadge, StatusBadge, Textarea, useToast } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { TrackingViewer } from '@/features/tracking';
import { formatDateTime, formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { usePickup, useReportPickupFailure } from '../api';
import { VerificationFlow } from '../components/VerificationFlow';

export default function PickupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const query = usePickup(id);
  const [reportOpen, setReportOpen] = useState(false);

  if (query.isPending) return <LoadingState label="Loading pickup…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} title="This pickup could not be loaded" />;
  const p = query.data;
  const activeTrack = p.trackingSessions.find((s) => s.stage === 'TO_PICKUP' && s.status === 'ACTIVE');
  const lastPickupTrack = activeTrack ?? [...p.trackingSessions].reverse().find((s) => s.stage === 'TO_PICKUP');
  const canReport = ['ASSIGNED', 'EN_ROUTE', 'VERIFIED'].includes(p.status);
  const approved = isOrganisationApproved(user);

  return (
    <>
      <PageHeader
        title={p.donation.foodName}
        description={`Collection by ${p.ngo.name}`}
        back={{ to: '/donor/pickups', label: 'Pickups' }}
        meta={
          <>
            <StatusBadge status={p.status} />
            <QuantityBadge quantity={p.donation.quantity} unit={p.donation.unit} />
            {['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? <Countdown to={p.donation.pickupDeadline} /> : null}
          </>
        }
        actions={
          canReport && approved ? (
            <Button variant="outline" leftIcon={<Flag className="size-4" aria-hidden="true" />} onClick={() => setReportOpen(true)}>
              Report a problem
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {approved ? (
            <VerificationFlow pickupId={p.id} onPickupIdentified={(other) => navigate(`/donor/pickups/${other}`)} />
          ) : (
            <Banner tone="warning">Verification is available once your organisation is approved.</Banner>
          )}
          {lastPickupTrack ? (
            // Remount (and refetch) when the pickup or session state changes, e.g. a handover ends the session server-side.
            <TrackingViewer key={`${lastPickupTrack.id}-${lastPickupTrack.status}-${p.status}`} sessionId={lastPickupTrack.id} destinationLabel="Your pickup point" fallbackDestination={p.donation.location} />
          ) : ['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? (
            <Card>
              <CardHeader title="LiveTrack" description="The representative has not started sharing their location for this pickup." />
              <CardBody>
                <MapView ariaLabel="Pickup point" markers={[{ id: 'pickup', position: p.donation.location, kind: 'pickup', label: 'P', title: 'Your pickup point' }]} height={220} />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Pickup details" as="h3" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { term: 'Food', description: `${p.donation.foodName} · ${DIETARY_LABELS[p.donation.dietaryType]}` },
                  { term: 'Reserved quantity', description: formatQuantity(p.donation.quantity, p.donation.unit) },
                  { term: 'NGO', description: p.ngo.name },
                  { term: 'Representative', description: p.representative.name },
                  { term: 'Scheduled', description: p.scheduledPickupAt ? formatDateTime(p.scheduledPickupAt) : 'Not scheduled' },
                  { term: 'Pickup deadline', description: formatDateTime(p.donation.pickupDeadline) },
                  { term: 'Pickup address', description: p.donation.address },
                  ...(p.handover
                    ? [
                        { term: 'Handover', description: <StatusBadge status={p.handover.status} /> },
                        { term: 'You confirmed', description: p.handover.donorConfirmedQuantity !== null ? formatQuantity(p.handover.donorConfirmedQuantity, p.donation.unit) : 'Not yet' },
                        { term: 'NGO confirmed', description: p.handover.ngoConfirmedAt ? 'Yes' : 'Not yet' },
                      ]
                    : []),
                  ...(p.delivery ? [{ term: 'Delivered', description: `${formatQuantity(p.delivery.deliveredQuantity, p.donation.unit)} on ${formatDateTime(p.delivery.confirmedAt)}` }] : []),
                  ...(p.cancelReason ? [{ term: 'Reason', description: p.cancelReason }] : []),
                ]}
              />
            </CardBody>
          </Card>
        </aside>
      </div>

      <ReportProblemDialog pickupId={p.id} open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}

function ReportProblemDialog({ pickupId, open, onClose }: { pickupId: string; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const report = useReportPickupFailure();
  const toast = useToast();
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Report a no-show or failed pickup"
      description="The pickup is marked as failed and the reservation is kept so the NGO can assign someone else before the deadline. FoodBridge is notified."
      tone="danger"
      confirmLabel="Report failure"
      confirmDisabled={reason.trim().length < 3}
      loading={report.isPending}
      onConfirm={() =>
        report
          .mutateAsync({ pickupId, reason: reason.trim() })
          .then(() => {
            toast.success('Pickup reported', 'The NGO has been notified.');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="What happened?" hint="For example: nobody arrived before the deadline, or the ID did not match." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
