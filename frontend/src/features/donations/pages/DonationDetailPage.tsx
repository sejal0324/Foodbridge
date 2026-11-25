import { Ban, History, Pencil, Send } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { MapView } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, Countdown, DescriptionList, ErrorState, LoadingState, PageHeader, ProgressBar, QuantityBadge, StatusBadge } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { usePickups } from '@/features/pickups/api';
import type { DonationDetail } from '@/types';
import { formatDateTime, formatQuantity, formatWindow } from '@/utils/format';
import { DIETARY_LABELS, STORAGE_LABELS } from '@/utils/labels';
import { useDonation } from '../api';
import { AllocationsPanel } from '../components/AllocationsPanel';
import { CancelDonationDialog } from '../components/CancelDonationDialog';
import { EditDonationDialog } from '../components/EditDonationDialog';
import { RecommendedNgosPanel } from '../components/RecommendedNgosPanel';
import { RequestsPanel } from '../components/RequestsPanel';
import { StatusTimeline } from '../components/StatusTimeline';

const EDITABLE = ['DRAFT', 'AVAILABLE', 'PARTIALLY_RESERVED'];
const CANCELLABLE = ['DRAFT', 'AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED'];

export default function DonationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useCurrentUser();
  const query = useDonation(id);
  const pickups = usePickups();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const approved = isOrganisationApproved(user);

  if (query.isPending) return <LoadingState label="Loading donation…" />;
  if (query.isError) return <ErrorState error={query.error} title="This donation could not be loaded" onRetry={() => void query.refetch()} />;
  const d = query.data;
  const open = ['AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED'].includes(d.status);

  return (
    <>
      <PageHeader
        title={d.foodName}
        description={`${d.category.name} · ${DIETARY_LABELS[d.dietaryType]}`}
        back={{ to: '/donor/donations', label: 'Donations' }}
        meta={
          <>
            <StatusBadge status={d.status} />
            <QuantityBadge quantity={d.availableQuantity} unit={d.unit} />
            <span className="text-xs text-slate-400">available of {formatQuantity(d.quantity, d.unit)}</span>
            {open ? <Countdown to={d.pickupDeadline} /> : null}
          </>
        }
        actions={
          approved ? (
            <>
              {EDITABLE.includes(d.status) ? (
                <Button variant={d.status === 'DRAFT' ? 'primary' : 'outline'} leftIcon={d.status === 'DRAFT' ? <Send className="size-4" aria-hidden="true" /> : <Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
                  {d.status === 'DRAFT' ? 'Edit & publish' : 'Edit'}
                </Button>
              ) : null}
              {CANCELLABLE.includes(d.status) ? (
                <Button variant="ghost" leftIcon={<Ban className="size-4" aria-hidden="true" />} onClick={() => setCancelling(true)}>
                  Cancel donation
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {d.warnings.length > 0 ? (
        <Banner tone="warning" title="Review flags" className="mb-6">
          <ul className="list-disc space-y-1 pl-5">
            {d.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-80">These flags never block a donation. Food safety remains the donor’s responsibility.</p>
        </Banner>
      ) : null}
      {d.status === 'DRAFT' ? (
        <Banner tone="info" title="This is a draft" className="mb-6">
          NGOs cannot see it yet. Confirm food safety and publish when the food is ready.
        </Banner>
      ) : null}
      {d.status === 'CANCELLED' && d.cancelledReason ? (
        <Banner tone="info" title="Cancelled" className="mb-6">
          Reason: {d.cancelledReason}
        </Banner>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <RequestsPanel donation={d} canAct={approved} />
          <AllocationsPanel donation={d} pickups={pickups.data ?? []} canAct={approved} />
          {d.status !== 'CANCELLED' && d.status !== 'EXPIRED' ? <RecommendedNgosPanel donation={d} /> : null}
        </div>
        <aside className="space-y-6">
          <SummaryCard d={d} />
          <Card>
            <CardHeader title="Status history" as="h3" icon={<History className="size-4" aria-hidden="true" />} />
            <CardBody>
              <StatusTimeline history={d.history} />
            </CardBody>
          </Card>
        </aside>
      </div>

      {editing ? <EditDonationDialog donation={d} onClose={() => setEditing(false)} /> : null}
      {cancelling ? <CancelDonationDialog donation={d} onClose={() => setCancelling(false)} /> : null}
    </>
  );
}

function SummaryCard({ d }: { d: DonationDetail }) {
  return (
    <Card>
      <CardHeader title="Details" as="h3" />
      <CardBody className="space-y-5">
        <div>
          <div className="mb-2 flex justify-between text-xs text-slate-400">
            <span>{formatQuantity(d.reservedQuantity, d.unit)} reserved</span>
            <span>{formatQuantity(d.availableQuantity, d.unit)} available</span>
          </div>
          <ProgressBar value={d.reservedQuantity} max={d.quantity} label="Share of the donation reserved" />
          {d.expiredQuantity > 0 ? <p className="mt-1 text-xs text-slate-500">{formatQuantity(d.expiredQuantity, d.unit)} expired unclaimed</p> : null}
        </div>
        <DescriptionList
          columns={1}
          items={[
            { term: 'Prepared', description: formatDateTime(d.preparedAt) },
            ...(d.bestBefore ? [{ term: 'Best before', description: formatDateTime(d.bestBefore) }] : []),
            { term: 'Storage', description: `${STORAGE_LABELS[d.storageType]}${d.storageNotes ? ` · ${d.storageNotes}` : ''}` },
            { term: 'Pickup window', description: formatWindow(d.pickupAvailableFrom, d.pickupDeadline) },
            { term: 'Pickup address', description: d.address },
            ...(d.description ? [{ term: 'Description', description: d.description }] : []),
            { term: 'Safety confirmation', description: d.safetyConfirmed ? 'Confirmed by the donor (FoodBridge does not certify food safety)' : 'Not yet confirmed' },
          ]}
        />
        {d.location ? <MapView ariaLabel="Pickup location" markers={[{ id: 'pickup', position: d.location, kind: 'pickup', label: 'P', title: d.address }]} height={200} /> : null}
      </CardBody>
    </Card>
  );
}
