import { HandHeart } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Card, DataTable, EmptyState, Field, PageHeader, Pagination, Select, StatusBadge, statusStyle } from '@/components/ui';
import { UrgencyBadge, useAssistanceRequests } from '@/features/assistance';
import { formatQuantity, formatRelative, formatWindow } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { FilterBar } from '../components/common';
import { useUrlFilters } from '../hooks';
import { ASSISTANCE_STATUS_OPTIONS } from '../labels';

export default function AdminAssistancePage() {
  const filters = useUrlFilters(['status'] as const);
  const query = useAssistanceRequests({ scope: 'all', page: filters.page, status: filters.values.status || undefined });

  return (
    <>
      <PageHeader title="Assistance requests" description="Food requests raised by NGOs across India and the offers donors made against them." />
      <Card>
        <div className="space-y-4 p-5">
          <FilterBar active={filters.active} onReset={filters.reset}>
            <Field label="Status" className="w-52">
              <Select
                value={filters.values.status}
                onChange={(e) => filters.set({ status: e.target.value })}
                options={[{ value: '', label: 'All statuses' }, ...ASSISTANCE_STATUS_OPTIONS.map((s) => ({ value: s, label: statusStyle(s).label }))]}
              />
            </Field>
          </FilterBar>
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState icon={<HandHeart className="size-6" aria-hidden="true" />} title={filters.active ? 'No requests with this status' : 'No assistance requests yet'} />}
          >
            {(data) => (
              <>
                <DataTable
                  caption="Assistance requests"
                  rows={data.items}
                  rowKey={(r) => r.id}
                  mobileTitle={(r) => (
                    <Link to={`/admin/assistance/${r.id}`} className="hover:underline">
                      {r.ngo.name}: {formatQuantity(r.quantityRequired, r.unit)}
                    </Link>
                  )}
                  columns={[
                    {
                      key: 'request',
                      header: 'Request',
                      cell: (r) => (
                        <div>
                          <Link to={`/admin/assistance/${r.id}`} className="font-medium text-white hover:underline">
                            {r.ngo.name}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {r.category.name} · {DIETARY_LABELS[r.dietaryRequirement]}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: 'qty',
                      header: 'Committed / needed',
                      cell: (r) => (
                        <span className="tabular-nums">
                          {r.quantityCommitted} / {formatQuantity(r.quantityRequired, r.unit)}
                        </span>
                      ),
                    },
                    { key: 'urgency', header: 'Urgency', cell: (r) => <UrgencyBadge urgency={r.urgency} /> },
                    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                    { key: 'window', header: 'Needed', cell: (r) => <span className="text-xs text-slate-400">{formatWindow(r.neededFrom, r.neededUntil)}</span> },
                    { key: 'created', header: 'Raised', cell: (r) => <span className="text-xs text-slate-400">{formatRelative(r.createdAt)}</span>, hideOnMobile: true },
                  ]}
                />
                <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => filters.set({ page: p })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
    </>
  );
}
