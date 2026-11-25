import { Ban, History } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { MapView } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, DataTable, DescriptionList, EmptyState, ErrorState, LoadingState, PageHeader, ProgressBar, StatusBadge, useToast } from '@/components/ui';
import { UrgencyBadge, useAssistanceRequest } from '@/features/assistance';
import type { AssistanceRequestDetail } from '@/types';
import { formatDateTime, formatNumber, formatQuantity, formatWindow } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useAdminCancelAssistanceRequest } from '../api';
import { StrongCancelDialog } from '../components/common';
import { CANCELLABLE_ASSISTANCE_STATUSES } from '../labels';

/** Read-only assistance request with its donor offers; admins may cancel it (audited). */
export default function AdminAssistanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useAssistanceRequest(id);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (query.isPending) return <LoadingState label="Loading request…" />;
  if (query.isError) return <ErrorState error={query.error} title="This request could not be loaded" onRetry={() => void query.refetch()} />;
  const r = query.data;

  return (
    <>
      <PageHeader
        title={`${r.ngo.name}: ${formatQuantity(r.quantityRequired, r.unit)}`}
        description={`${r.category.name} · ${DIETARY_LABELS[r.dietaryRequirement]} · ${formatNumber(r.beneficiariesCount)} people`}
        back={{ to: '/admin/assistance', label: 'Assistance requests' }}
        meta={
          <>
            <StatusBadge status={r.status} />
            <UrgencyBadge urgency={r.urgency} />
          </>
        }
        actions={
          <>
            <Link to={`/admin/audit?entityType=assistance_request&entityId=${r.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
              <History className="size-4" aria-hidden="true" /> Audit trail
            </Link>
            {CANCELLABLE_ASSISTANCE_STATUSES.has(r.status) ? (
              <Button variant="danger" leftIcon={<Ban className="size-4" aria-hidden="true" />} onClick={() => setCancelOpen(true)}>
                Cancel request
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Progress" />
            <CardBody className="space-y-2">
              <ProgressBar value={r.quantityCommitted} max={r.quantityRequired} label="Quantity committed by donors" />
              <p className="text-sm text-slate-300">
                {formatQuantity(r.quantityCommitted, r.unit)} committed · {formatQuantity(r.quantityReceived, r.unit)} received · {formatQuantity(r.quantityRemaining, r.unit)} still needed
              </p>
            </CardBody>
          </Card>
          <OffersCard request={r} />
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Request details" as="h3" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { term: 'NGO', description: r.ngo.name },
                  { term: 'Needed', description: formatWindow(r.neededFrom, r.neededUntil) },
                  { term: 'Delivery / collection address', description: r.address },
                  { term: 'People served', description: formatNumber(r.beneficiariesCount) },
                  ...(r.reason ? [{ term: 'Reason', description: r.reason }] : []),
                  ...(r.additionalRequirements ? [{ term: 'Additional requirements', description: r.additionalRequirements }] : []),
                  { term: 'Raised', description: formatDateTime(r.createdAt) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Location" as="h3" />
            <CardBody>
              <MapView ariaLabel={`Location of ${r.ngo.name}'s request`} markers={[{ id: 'ngo', position: r.location, kind: 'ngo', label: 'N', title: r.address }]} height={220} />
            </CardBody>
          </Card>
        </aside>
      </div>
      <CancelRequestDialog request={r} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </>
  );
}

function OffersCard({ request }: { request: AssistanceRequestDetail }) {
  return (
    <Card>
      <CardHeader title="Donor offers" description="Offers made against this request (admins see all of them)." />
      <CardBody>
        {request.offers.length === 0 ? (
          <EmptyState compact title="No offers yet" />
        ) : (
          <DataTable
            caption="Donor offers"
            rows={request.offers}
            rowKey={(o) => o.id}
            columns={[
              {
                key: 'donor',
                header: 'Donor',
                cell: (o) => (
                  <div>
                    <p className="font-medium text-white">{o.donor.name}</p>
                    <p className="text-xs text-slate-500">
                      {o.foodName} · {DIETARY_LABELS[o.dietaryType]}
                    </p>
                  </div>
                ),
              },
              {
                key: 'qty',
                header: 'Offered / accepted / confirmed',
                cell: (o) => (
                  <span className="tabular-nums">
                    {o.offeredQuantity} / {o.acceptedQuantity ?? '—'} / {o.confirmedQuantity ?? '—'}
                  </span>
                ),
              },
              { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
              { key: 'window', header: 'Pickup', cell: (o) => <span className="text-xs text-slate-400">{formatWindow(o.pickupAvailableFrom, o.pickupDeadline)}</span>, hideOnMobile: true },
              {
                key: 'donation',
                header: 'Donation',
                cell: (o) =>
                  o.donationId ? (
                    <Link to={`/admin/donations/${o.donationId}`} className="text-brand-300 hover:underline">
                      View donation
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-500">{o.rejectionReason ?? o.cancelReason ?? '—'}</span>
                  ),
              },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

function CancelRequestDialog({ request, open, onClose }: { request: AssistanceRequestDetail; open: boolean; onClose: () => void }) {
  const cancel = useAdminCancelAssistanceRequest(request.id);
  const toast = useToast();
  const activeOffers = request.offers.filter((o) => ['PROPOSED', 'ACCEPTED', 'RESERVED', 'PICKUP_ASSIGNED'].includes(o.status)).length;
  return (
    <StrongCancelDialog
      open={open}
      onClose={onClose}
      title="Cancel this assistance request?"
      description={`Raised by ${request.ngo.name}. This cannot be undone.`}
      consequences={
        <Banner tone="warning">
          Pending offers are rejected and food already reserved for this request is released{activeOffers > 0 ? ` (${activeOffers} active offer${activeOffers === 1 ? '' : 's'})` : ''}. The NGO and affected donors are notified.
        </Banner>
      }
      acknowledgement="I understand this cancels the request for the NGO and every donor who offered food."
      confirmLabel="Cancel request"
      reasonHint="At least 3 characters. Shared with the NGO and donors and recorded in the audit log."
      loading={cancel.isPending}
      onConfirm={(reason) =>
        cancel
          .mutateAsync(reason)
          .then(() => {
            toast.success('Request cancelled', 'The NGO and affected donors have been notified.');
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
