import { ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, Select, StatusBadge } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/utils/format';
import { useVerificationQueue, type VerificationQueueParams } from '../api';
import { ApplicationPanel } from '../components/ApplicationPanel';
import { FilterBar } from '../components/common';
import { useUrlFilters } from '../hooks';
import { ORG_TYPE_LABEL } from '../labels';
import type { VerificationApplication } from '../types';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUSPENDED', label: 'Suspended' },
];
const TYPE_OPTIONS = [
  { value: '', label: 'Donors and NGOs' },
  { value: 'DONOR', label: 'Donors' },
  { value: 'NGO', label: 'NGOs' },
];

export default function VerificationsPage() {
  const filters = useUrlFilters(['status', 'type'] as const, { status: 'PENDING' });
  const status = filters.values.status as NonNullable<VerificationQueueParams['status']>;
  const type = (filters.values.type || undefined) as VerificationQueueParams['type'];
  const query = useVerificationQueue({ status, type });
  const [selected, setSelected] = useState<VerificationApplication | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const open = (app: VerificationApplication) => {
    setSelected(app);
    // On small screens the panel is above the list: bring it into view.
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <>
      <PageHeader
        title="Verifications"
        description="Review donor and NGO applications and their documents. Only approved organisations can list, request or collect food."
        meta={query.data && status === 'PENDING' ? <Badge tone={query.data.length > 0 ? 'warning' : 'success'}>{query.data.length} waiting</Badge> : null}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-w-0">
          <div className="space-y-4 p-5">
            <FilterBar active={filters.active} onReset={filters.reset}>
              <Field label="Status" className="w-48">
                <Select value={status} onChange={(e) => filters.set({ status: e.target.value })} options={STATUS_OPTIONS} />
              </Field>
              <Field label="Organisation type" className="w-48">
                <Select value={filters.values.type} onChange={(e) => filters.set({ type: e.target.value })} options={TYPE_OPTIONS} />
              </Field>
            </FilterBar>
            <QueryState
              query={query}
              empty={
                <EmptyState
                  icon={<ShieldCheck className="size-6" aria-hidden="true" />}
                  title={status === 'PENDING' ? 'No applications waiting' : 'No organisations with this status'}
                  description={status === 'PENDING' ? 'New donor and NGO registrations appear here for review.' : undefined}
                />
              }
            >
              {(rows) => (
                <DataTable
                  caption="Verification applications"
                  rows={rows}
                  rowKey={(r) => `${r.type}-${r.id}`}
                  columns={[
                    {
                      key: 'org',
                      header: 'Organisation',
                      cell: (r) => (
                        <div>
                          <p className="font-medium text-white">{r.name}</p>
                          <p className="text-xs text-slate-500">
                            {ORG_TYPE_LABEL[r.type]}
                            {r.city ? ` · ${r.city}` : ''}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: 'owner',
                      header: 'Owner',
                      cell: (r) => (
                        <div className="min-w-0">
                          <p className="text-slate-200">{r.ownerName}</p>
                          <p className="truncate text-xs text-slate-500">{r.ownerEmail}</p>
                        </div>
                      ),
                    },
                    { key: 'docs', header: 'Documents', align: 'right', cell: (r) => (r.documentCount > 0 ? r.documentCount : <span className="text-amber-300">None</span>) },
                    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.verificationStatus} /> },
                    { key: 'created', header: 'Registered', cell: (r) => <span title={formatDateTime(r.createdAt)} className="text-xs text-slate-400">{formatRelative(r.createdAt)}</span> },
                    {
                      key: 'actions',
                      header: <span className="sr-only">Actions</span>,
                      cell: (r) => (
                        <Button size="sm" variant={selected?.id === r.id ? 'secondary' : 'outline'} onClick={() => open(r)} aria-label={`Review ${r.name}`}>
                          Review
                        </Button>
                      ),
                    },
                  ]}
                />
              )}
            </QueryState>
          </div>
        </Card>
        <div ref={panelRef} className={selected ? 'order-first scroll-mt-20 lg:order-none' : 'hidden lg:block'}>
          {selected ? (
            <ApplicationPanel key={`${selected.type}-${selected.id}`} application={selected} onClose={() => setSelected(null)} onDecided={() => setSelected(null)} />
          ) : (
            <Card>
              <EmptyState compact title="Select an application" description="Its details, documents and the approve, reject and suspend actions appear here." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
