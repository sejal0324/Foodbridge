import { Ban, History } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { MapView } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, DataTable, DescriptionList, EmptyState, ErrorState, LoadingState, PageHeader, QuantityBadge, StatusBadge, useToast } from '@/components/ui';
import { useCancelDonation, useDonation } from '@/features/donations/api';
import { StatusTimeline } from '@/features/donations/components/StatusTimeline';
import { usePickups } from '@/features/pickups/api';
import type { DonationDetail } from '@/types';
import { formatDateTime, formatQuantity, formatWindow, humanize } from '@/utils/format';
import { DIETARY_LABELS, STORAGE_LABELS } from '@/utils/labels';
import { StrongCancelDialog } from '../components/common';
import { CANCELLABLE_DONATION_STATUSES } from '../labels';

/** Read-only donation view for admins (history, NGO requests, collections), with an audited cancel. */
export default function AdminDonationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useDonation(id);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (query.isPending) return <LoadingState label="Loading donation…" />;
  if (query.isError) return <ErrorState error={query.error} title="This donation could not be loaded" onRetry={() => void query.refetch()} />;
  const d = query.data;
  const cancellable = CANCELLABLE_DONATION_STATUSES.has(d.status);

  return (
    <>
      <PageHeader
        title={d.foodName}
        description={`Listed by ${d.donor.name} · ${d.category.name}`}
        back={{ to: '/admin/donations', label: 'All donations' }}
        meta={
          <>
            <StatusBadge status={d.status} />
            <QuantityBadge quantity={d.quantity} unit={d.unit} />
          </>
        }
        actions={
          <>
            <Link to={`/admin/audit?entityType=donation&entityId=${d.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
              <History className="size-4" aria-hidden="true" /> Audit trail
            </Link>
            {cancellable ? (
              <Button variant="danger" leftIcon={<Ban className="size-4" aria-hidden="true" />} onClick={() => setCancelOpen(true)}>
                Cancel donation
              </Button>
            ) : null}
          </>
        }
      />
      <Banner tone="info" className="mb-6">
        Read-only view. Admins can see everything about this donation but only the donor can edit it; cancelling is recorded in the audit log.
      </Banner>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <RequestsCard donation={d} />
          <AllocationsCard donation={d} />
          <Card>
            <CardHeader title="Status history" />
            <CardBody>
              <StatusTimeline history={d.history} />
            </CardBody>
          </Card>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Donation details" as="h3" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { term: 'Donor', description: d.donor.name },
                  { term: 'Food', description: `${d.foodName} · ${DIETARY_LABELS[d.dietaryType]}` },
                  { term: 'Quantity', description: `${formatQuantity(d.quantity, d.unit)} (${d.reservedQuantity} reserved, ${d.availableQuantity} available${d.expiredQuantity ? `, ${d.expiredQuantity} expired` : ''})` },
                  { term: 'Prepared', description: formatDateTime(d.preparedAt) },
                  { term: 'Best before', description: formatDateTime(d.bestBefore, 'Not given') },
                  { term: 'Storage', description: `${STORAGE_LABELS[d.storageType]}${d.storageNotes ? ` — ${d.storageNotes}` : ''}` },
                  { term: 'Pickup window', description: formatWindow(d.pickupAvailableFrom, d.pickupDeadline) },
                  { term: 'Pickup address', description: d.address },
                  { term: 'Origin', description: d.origin === 'ASSISTANCE_OFFER' ? 'Donor offer to an NGO request' : 'Direct listing' },
                  { term: 'Food safety confirmed', description: d.safetyConfirmed ? 'Yes, by the donor' : 'No' },
                  ...(d.description ? [{ term: 'Description', description: d.description }] : []),
                  ...(d.cancelledReason ? [{ term: 'Cancellation reason', description: d.cancelledReason }] : []),
                  { term: 'Listed', description: formatDateTime(d.createdAt) },
                ]}
              />
            </CardBody>
          </Card>
          {d.location ? (
            <Card>
              <CardHeader title="Pickup location" as="h3" />
              <CardBody>
                <MapView ariaLabel={`Pickup location of ${d.foodName}`} markers={[{ id: 'pickup', position: d.location, kind: 'pickup', label: 'P', title: d.address }]} height={220} />
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
      <CancelDonationAdminDialog donation={d} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </>
  );
}

function RequestsCard({ donation }: { donation: DonationDetail }) {
  return (
    <Card>
      <CardHeader title="NGO requests" description="Requests NGOs made for this donation and the donor's decisions." />
      <CardBody>
        {donation.requests.length === 0 ? (
          <EmptyState compact title="No requests" />
        ) : (
          <DataTable
            caption="NGO requests"
            rows={donation.requests}
            rowKey={(r) => r.id}
            columns={[
              { key: 'ngo', header: 'NGO', cell: (r) => <span className="font-medium text-white">{r.ngo.name}</span> },
              { key: 'req', header: 'Requested', align: 'right', cell: (r) => formatQuantity(r.requestedQuantity, donation.unit) },
              { key: 'app', header: 'Approved', align: 'right', cell: (r) => (r.approvedQuantity === null ? '—' : formatQuantity(r.approvedQuantity, donation.unit)) },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { key: 'when', header: 'Requested at', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>, hideOnMobile: true },
              { key: 'reason', header: 'Decision note', cell: (r) => <span className="text-xs text-slate-400">{r.decisionReason ?? r.message ?? '—'}</span>, hideOnMobile: true },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

function AllocationsCard({ donation }: { donation: DonationDetail }) {
  const pickups = usePickups();
  const pickupByAllocation = new Map((pickups.data ?? []).map((p) => [p.allocationId, p]));
  return (
    <Card>
      <CardHeader title="Collections" description="Quantities reserved for NGOs and what was handed over." />
      <CardBody>
        {donation.allocations.length === 0 ? (
          <EmptyState compact title="Nothing reserved yet" />
        ) : (
          <DataTable
            caption="Collections"
            rows={donation.allocations}
            rowKey={(r) => r.id}
            columns={[
              { key: 'ngo', header: 'NGO', cell: (r) => <span className="font-medium text-white">{r.ngo.name}</span> },
              { key: 'qty', header: 'Reserved', align: 'right', cell: (r) => formatQuantity(r.quantity, donation.unit) },
              { key: 'handed', header: 'Handed over', align: 'right', cell: (r) => (r.handedOverQuantity === null ? '—' : formatQuantity(r.handedOverQuantity, donation.unit)) },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { key: 'source', header: 'Source', cell: (r) => <span className="text-xs text-slate-400">{humanize(r.source)}</span>, hideOnMobile: true },
              {
                key: 'pickup',
                header: 'Pickup',
                cell: (r) => {
                  const p = pickupByAllocation.get(r.id);
                  return p ? (
                    <Link to={`/admin/pickups/${p.id}`} className="text-brand-300 hover:underline">
                      View pickup
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-500">{pickups.isPending ? '…' : 'Not assigned'}</span>
                  );
                },
              },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

function CancelDonationAdminDialog({ donation, open, onClose }: { donation: DonationDetail; open: boolean; onClose: () => void }) {
  const cancel = useCancelDonation(donation.id);
  const toast = useToast();
  const affected = donation.allocations.filter((a) => a.status === 'RESERVED' || a.status === 'PICKUP_ASSIGNED').length;
  const pending = donation.requests.filter((r) => r.status === 'PENDING').length;
  return (
    <StrongCancelDialog
      open={open}
      onClose={onClose}
      title={`Cancel “${donation.foodName}”?`}
      description={`Listed by ${donation.donor.name}. This cannot be undone.`}
      consequences={
        <Banner tone="warning">
          {affected > 0 ? `${affected} reservation${affected === 1 ? '' : 's'} not yet picked up will be released` : 'No reservations are affected'}
          {pending > 0 ? ` and ${pending} pending request${pending === 1 ? '' : 's'} will be cancelled` : ''}. Affected NGOs are notified. Cancellation is refused if any food has already been handed over.
        </Banner>
      }
      acknowledgement="I understand this cancels the donation for the donor and every NGO involved."
      confirmLabel="Cancel donation"
      reasonHint="At least 3 characters. Shared with affected NGOs and recorded in the audit log."
      loading={cancel.isPending}
      onConfirm={(reason) =>
        cancel
          .mutateAsync(reason)
          .then(() => {
            toast.success('Donation cancelled', 'Affected NGOs have been notified.');
            return true;
          })
          .catch((e: unknown) => {
            toast.error(e);
            return false;
          })
      }
    />
  );
}
