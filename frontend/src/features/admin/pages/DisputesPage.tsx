import { Scale } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, DataTable, EmptyState, PageHeader, StatusBadge, Tabs } from '@/components/ui';
import { formatDateTime, formatRelative, humanize } from '@/utils/format';
import { useDisputes } from '../api';
import { DisputeResolveDialog } from '../components/DisputeResolveDialog';
import { useUrlFilters } from '../hooks';
import type { Dispute, DisputeStatus } from '../types';

const STATUS_TABS: { value: DisputeStatus | 'ALL'; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
];

export default function DisputesPage() {
  const filters = useUrlFilters(['status'] as const, { status: 'OPEN' });
  const status = (STATUS_TABS.find((t) => t.value === filters.values.status)?.value ?? 'OPEN') as DisputeStatus | 'ALL';
  const query = useDisputes(status === 'ALL' ? '' : status);
  const [resolving, setResolving] = useState<Dispute | null>(null);

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Handovers where the donor and the NGO confirmed different quantities. No points or fees are recorded until you resolve them."
      />
      <Card>
        <div className="px-5 pt-3">
          <Tabs label="Filter disputes by status" value={status} onChange={(v) => filters.set({ status: v })} items={STATUS_TABS} />
        </div>
        <div className="space-y-4 p-5">
          <QueryState
            query={query}
            empty={
              <EmptyState
                icon={<Scale className="size-6" aria-hidden="true" />}
                title={status === 'OPEN' ? 'No open disputes' : 'No disputes with this status'}
                description={status === 'OPEN' ? 'A dispute is opened automatically when the donor and NGO confirm different handover quantities.' : undefined}
              />
            }
          >
            {(rows) => (
              <>
                <DataTable
                  caption="Disputes"
                  rows={rows}
                  rowKey={(r) => r.id}
                  columns={[
                    {
                      key: 'food',
                      header: 'Collection',
                      cell: (r) => (
                        <div>
                          <p className="font-medium text-white">{r.foodName}</p>
                          <p className="text-xs text-slate-500">
                            {r.donorName} → {r.ngoName}
                          </p>
                        </div>
                      ),
                    },
                    { key: 'type', header: 'Type', cell: (r) => <span className="text-xs">{humanize(r.type)}</span>, hideOnMobile: true },
                    { key: 'donor', header: 'Donor says', align: 'right', cell: (r) => r.donorQuantity ?? '—' },
                    { key: 'ngo', header: 'NGO says', align: 'right', cell: (r) => r.ngoQuantity ?? '—' },
                    { key: 'alloc', header: 'Allocated', align: 'right', cell: (r) => r.allocatedQuantity },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (r) => (
                        <div className="flex flex-col items-end gap-1 md:items-start">
                          <StatusBadge status={r.status} label={r.status === 'REJECTED' ? 'Cancelled' : undefined} />
                          {r.resolvedQuantity !== null ? <Badge tone="brand">Confirmed {r.resolvedQuantity}</Badge> : null}
                        </div>
                      ),
                    },
                    { key: 'opened', header: 'Opened', cell: (r) => <span className="text-xs text-slate-400" title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</span>, hideOnMobile: true },
                    {
                      key: 'actions',
                      header: <span className="sr-only">Actions</span>,
                      cell: (r) => (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {r.pickupId ? (
                            <Link to={`/admin/pickups/${r.pickupId}`} className="text-sm text-brand-300 hover:underline">
                              Pickup
                            </Link>
                          ) : null}
                          {r.status === 'OPEN' || r.status === 'UNDER_REVIEW' ? (
                            <Button size="sm" onClick={() => setResolving(r)} aria-label={`Resolve dispute for ${r.foodName}`}>
                              Resolve
                            </Button>
                          ) : null}
                        </div>
                      ),
                    },
                  ]}
                />
                {rows.some((r) => r.resolution) ? <ResolutionNotes rows={rows.filter((r) => r.resolution)} /> : null}
              </>
            )}
          </QueryState>
        </div>
      </Card>
      {resolving ? <DisputeResolveDialog dispute={resolving} unit={resolving.unit} onClose={() => setResolving(null)} /> : null}
    </>
  );
}

function ResolutionNotes({ rows }: { rows: Dispute[] }) {
  return (
    <section aria-label="Resolutions" className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-300">Resolutions</h2>
      {rows.map((r) => (
        <Banner key={r.id} tone={r.status === 'REJECTED' ? 'warning' : 'success'} title={`${r.foodName} · ${r.donorName} → ${r.ngoName}`}>
          {r.resolution} {r.resolvedAt ? <span className="text-xs opacity-75">({formatDateTime(r.resolvedAt)})</span> : null}
        </Banner>
      ))}
    </section>
  );
}
