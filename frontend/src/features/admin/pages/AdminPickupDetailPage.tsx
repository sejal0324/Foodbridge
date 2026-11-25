import { Eye, History } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { MapView, type MapMarker } from '@/components/map';
import { Badge, ButtonLink, Card, CardBody, CardHeader, DataTable, DescriptionList, EmptyState, ErrorState, LoadingState, PageHeader, QuantityBadge, StatusBadge } from '@/components/ui';
import { usePickup } from '@/features/pickups/api';
import { useNow } from '@/hooks/useNow';
import type { PickupDetail } from '@/types';
import { formatDateTime, formatQuantity, humanize } from '@/utils/format';
import { DIETARY_LABELS, ID_DOCUMENT_LABELS } from '@/utils/labels';
import { useVerificationLog } from '../api';
import { isOverdue } from '../helpers';
import { VERIFICATION_METHOD_LABELS } from '../labels';

/** Read-only pickup view for admins: checks, handover, delivery, tracking and verification attempts. */
export default function AdminPickupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = usePickup(id);
  const now = useNow(60_000);

  if (query.isPending) return <LoadingState label="Loading pickup…" />;
  if (query.isError) return <ErrorState error={query.error} title="This pickup could not be loaded" onRetry={() => void query.refetch()} />;
  const p = query.data;
  const markers: MapMarker[] = [{ id: 'pickup', position: p.donation.location, kind: 'pickup', label: 'P', title: `Pickup: ${p.donation.address}` }];
  if (p.destination) markers.push({ id: 'dest', position: p.destination.location, kind: 'destination', label: 'D', title: `Destination: ${p.destination.address ?? 'NGO destination'}` });

  return (
    <>
      <PageHeader
        title={p.donation.foodName}
        description={`${p.donor.name} → ${p.ngo.name}`}
        back={{ to: '/admin/pickups', label: 'Pickups' }}
        meta={
          <>
            <StatusBadge status={p.status} />
            <QuantityBadge quantity={p.donation.quantity} unit={p.donation.unit} />
            {isOverdue(p, now) ? <Badge tone="danger">Overdue</Badge> : null}
          </>
        }
        actions={
          <Link to={`/admin/audit?entityType=pickup&entityId=${p.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
            <History className="size-4" aria-hidden="true" /> Audit trail
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <ChecksCard pickup={p} />
          <TrackingCard pickup={p} />
          <AttemptsCard pickupId={p.id} />
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Collection" as="h3" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { term: 'Food', description: `${p.donation.foodName} · ${DIETARY_LABELS[p.donation.dietaryType]}` },
                  { term: 'Reserved quantity', description: formatQuantity(p.donation.quantity, p.donation.unit) },
                  { term: 'Donor', description: p.donor.name },
                  { term: 'NGO', description: p.ngo.name },
                  { term: 'Representative', description: `${p.representative.name} (${humanize(p.representative.status)})` },
                  { term: 'Representative phone', description: p.representative.phone ?? '—' },
                  { term: 'ID shown', description: `${ID_DOCUMENT_LABELS[p.representative.idDocumentType] ?? p.representative.idDocumentType} ending ${p.representative.idDocumentLast4}` },
                  { term: 'Scheduled', description: formatDateTime(p.scheduledPickupAt, 'Not scheduled') },
                  { term: 'Pickup deadline', description: formatDateTime(p.donation.pickupDeadline) },
                  { term: 'Pickup address', description: p.donation.address },
                  ...(p.destination ? [{ term: 'Destination', description: p.destination.address ?? 'Set on the map' }] : []),
                  ...(p.cancelReason ? [{ term: 'Cancellation / failure reason', description: p.cancelReason }] : []),
                  { term: 'Donation', description: <Link to={`/admin/donations/${p.donation.id}`} className="text-brand-300 hover:underline">Open donation</Link> },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Map" as="h3" />
            <CardBody>
              <MapView ariaLabel="Pickup point and destination" markers={markers} fitToContent height={240} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function ChecksCard({ pickup: p }: { pickup: PickupDetail }) {
  const steps = [
    { label: 'Assigned', at: p.createdAt },
    { label: 'QR pass verified', at: p.checks.qrVerifiedAt },
    { label: 'ID checked by donor', at: p.checks.identityConfirmedAt },
    { label: 'Handed over (both confirmed)', at: p.handedOverAt },
    { label: 'Delivered', at: p.deliveredAt },
  ];
  return (
    <Card>
      <CardHeader title="Verification and handover" description="Each step is recorded with its time; points and the NGO fee are recorded only after both sides confirm the same quantity." />
      <CardBody className="space-y-5">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s) => (
            <li key={s.label} className={s.at ? 'rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-3' : 'rounded-xl border border-white/10 p-3'}>
              <p className="text-sm font-medium text-white">{s.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{s.at ? formatDateTime(s.at) : 'Not yet'}</p>
            </li>
          ))}
        </ol>
        <DescriptionList
          items={[
            { term: 'Handover', description: p.handover ? <StatusBadge status={p.handover.status} /> : 'Not started' },
            { term: 'Donor confirmed', description: p.handover?.donorConfirmedQuantity != null ? formatQuantity(p.handover.donorConfirmedQuantity, p.donation.unit) : '—' },
            { term: 'NGO confirmed', description: p.handover?.ngoReceivedQuantity != null ? formatQuantity(p.handover.ngoReceivedQuantity, p.donation.unit) : '—' },
            ...(p.delivery
              ? [{ term: 'Delivery', description: `${formatQuantity(p.delivery.deliveredQuantity, p.donation.unit)} on ${formatDateTime(p.delivery.confirmedAt)}${p.delivery.beneficiariesServed !== null ? ` · ${p.delivery.beneficiariesServed} people served` : ''}` }]
              : []),
          ]}
        />
      </CardBody>
    </Card>
  );
}

function TrackingCard({ pickup: p }: { pickup: PickupDetail }) {
  return (
    <Card>
      <CardHeader title="LiveTrack sessions" description="Opening a session shows the representative’s location; every view is recorded in the audit log." />
      <CardBody>
        {p.trackingSessions.length === 0 ? (
          <EmptyState compact title="No tracking sessions" description="The representative has not shared their location for this pickup." />
        ) : (
          <ul className="divide-y divide-white/5">
            {p.trackingSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-white">{s.stage === 'TO_PICKUP' ? 'To the pickup point' : 'To the destination'}</p>
                  <p className="text-xs text-slate-400">Last position {formatDateTime(s.lastRecordedAt, 'never received')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  <ButtonLink to={`/admin/pickups/tracking/${s.id}`} size="sm" variant="outline" leftIcon={<Eye className="size-4" aria-hidden="true" />}>
                    View
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function AttemptsCard({ pickupId }: { pickupId: string }) {
  const log = useVerificationLog();
  const rows = (log.data ?? []).filter((r) => r.pickupId === pickupId);
  return (
    <Card>
      <CardHeader title="Verification attempts" description="QR scans and ID checks for this pickup (from the latest 200 attempts platform-wide)." />
      <CardBody>
        {log.isPending ? (
          <LoadingState />
        ) : log.isError ? (
          <ErrorState error={log.error} compact onRetry={() => void log.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState compact title="No attempts recorded" />
        ) : (
          <DataTable
            caption="Verification attempts for this pickup"
            rows={rows}
            rowKey={(r) => String(r.id)}
            columns={[
              { key: 'time', header: 'Time', cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span> },
              { key: 'method', header: 'Method', cell: (r) => VERIFICATION_METHOD_LABELS[r.method] ?? r.method },
              { key: 'result', header: 'Result', cell: (r) => <Badge tone={r.result === 'SUCCESS' ? 'success' : 'danger'}>{r.result === 'SUCCESS' ? 'Success' : 'Failure'}</Badge> },
              { key: 'reason', header: 'Failure reason', cell: (r) => (r.failureReason ? humanize(r.failureReason) : '—') },
              { key: 'actor', header: 'Actor', cell: (r) => <span className="text-xs break-all">{r.actorEmail ?? '—'}</span> },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}
