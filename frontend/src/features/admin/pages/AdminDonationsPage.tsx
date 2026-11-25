import { UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Card, Countdown, DataTable, EmptyState, Field, PageHeader, Pagination, Select, StatusBadge, statusStyle } from '@/components/ui';
import { useFoodCategories } from '@/features/donations/api';
import type { Donation } from '@/types';
import { formatDateTime, formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useAdminDonations } from '../api';
import { FilterBar } from '../components/common';
import { useUrlFilters } from '../hooks';
import { DONATION_STATUS_OPTIONS } from '../labels';

const OPEN_STATUSES = new Set(['AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED']);

export default function AdminDonationsPage() {
  const filters = useUrlFilters(['status', 'categoryId', 'dietaryType'] as const);
  const { values } = filters;
  const categories = useFoodCategories();
  const query = useAdminDonations({ page: filters.page, status: values.status, categoryId: values.categoryId, dietaryType: values.dietaryType });

  return (
    <>
      <PageHeader title="Donations" description="Every donation listed on FoodBridge across India. Open one to see its history, NGO requests and collections." />
      <Card>
        <div className="space-y-4 p-5">
          <FilterBar active={filters.active} onReset={filters.reset}>
            <Field label="Status" className="w-48">
              <Select
                value={values.status}
                onChange={(e) => filters.set({ status: e.target.value })}
                options={[{ value: '', label: 'All statuses' }, ...DONATION_STATUS_OPTIONS.map((s) => ({ value: s, label: statusStyle(s).label }))]}
              />
            </Field>
            <Field label="Category" className="w-52">
              <Select
                value={values.categoryId}
                onChange={(e) => filters.set({ categoryId: e.target.value })}
                options={[{ value: '', label: categories.isPending ? 'Loading…' : 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Field>
            <Field label="Dietary type" className="w-44">
              <Select
                value={values.dietaryType}
                onChange={(e) => filters.set({ dietaryType: e.target.value })}
                options={[
                  { value: '', label: 'Veg and non-veg' },
                  { value: 'VEG', label: DIETARY_LABELS.VEG },
                  { value: 'NON_VEG', label: DIETARY_LABELS.NON_VEG },
                ]}
              />
            </Field>
          </FilterBar>
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState icon={<UtensilsCrossed className="size-6" aria-hidden="true" />} title={filters.active ? 'No donations match these filters' : 'No donations yet'} />}
          >
            {(data) => (
              <>
                <AdminDonationsTable rows={data.items} />
                <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => filters.set({ page: p })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
    </>
  );
}

function AdminDonationsTable({ rows }: { rows: Donation[] }) {
  return (
    <DataTable
      caption="All donations"
      rows={rows}
      rowKey={(r) => r.id}
      mobileTitle={(r) => (
        <Link to={`/admin/donations/${r.id}`} className="hover:underline">
          {r.foodName}
        </Link>
      )}
      columns={[
        {
          key: 'food',
          header: 'Food',
          cell: (r) => (
            <div>
              <Link to={`/admin/donations/${r.id}`} className="font-medium text-white hover:underline">
                {r.foodName}
              </Link>
              <p className="text-xs text-slate-500">
                {r.category.name} · {DIETARY_LABELS[r.dietaryType]}
              </p>
            </div>
          ),
        },
        { key: 'donor', header: 'Donor', cell: (r) => r.donor.name },
        {
          key: 'qty',
          header: 'Available / total',
          cell: (r) => (
            <span className="tabular-nums">
              {r.availableQuantity} / {formatQuantity(r.quantity, r.unit)}
            </span>
          ),
        },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        {
          key: 'deadline',
          header: 'Pickup deadline',
          cell: (r) => (OPEN_STATUSES.has(r.status) ? <Countdown to={r.pickupDeadline} /> : <span className="text-xs text-slate-400">{formatDateTime(r.pickupDeadline)}</span>),
        },
        { key: 'created', header: 'Listed', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>, hideOnMobile: true },
      ]}
    />
  );
}
