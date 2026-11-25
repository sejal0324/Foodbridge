import { Plus, UtensilsCrossed } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { ButtonLink, Card, Countdown, DataTable, EmptyState, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import type { Donation } from '@/types';
import { formatDateTime, formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useDonations } from '../api';
import { DONATION_STATUS_FILTERS } from '../schemas';

type FilterValue = (typeof DONATION_STATUS_FILTERS)[number]['value'];
const OPEN_STATUSES = ['AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED'];

export default function DonationListPage() {
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const filter = (DONATION_STATUS_FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'all') as FilterValue;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const statuses = DONATION_STATUS_FILTERS.find((f) => f.value === filter)?.statuses ?? '';
  const query = useDonations({ page, status: statuses || undefined });
  const approved = isOrganisationApproved(user);

  const update = (next: { status?: string; page?: number }) => {
    const p = new URLSearchParams(params);
    if (next.status !== undefined) {
      if (next.status === 'all') p.delete('status');
      else p.set('status', next.status);
      p.delete('page');
    }
    if (next.page !== undefined) p.set('page', String(next.page));
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Donations"
        description="Food you have listed, its reservations and its status."
        actions={
          approved ? (
            <ButtonLink to="/donor/donations/new" leftIcon={<Plus className="size-4" aria-hidden="true" />}>
              New donation
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <div className="px-5 pt-3">
          <Tabs label="Filter donations by status" value={filter} onChange={(v) => update({ status: v })} items={DONATION_STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
        </div>
        <div className="space-y-4 p-5">
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <EmptyState
                icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
                title={filter === 'all' ? 'No donations yet' : 'No donations with this status'}
                description={approved ? 'List surplus food and FoodBridge notifies matched NGOs nearby.' : 'You can list food once your organisation is verified.'}
                action={
                  approved && filter === 'all' ? (
                    <ButtonLink to="/donor/donations/new" leftIcon={<Plus className="size-4" aria-hidden="true" />}>
                      List surplus food
                    </ButtonLink>
                  ) : null
                }
              />
            }
          >
            {(data) => (
              <>
                <DonationsTable rows={data.items} />
                <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => update({ page: p })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
    </>
  );
}

export function DonationsTable({ rows }: { rows: Donation[] }) {
  return (
    <DataTable
      caption="Donations"
      rows={rows}
      rowKey={(r) => r.id}
      mobileTitle={(r) => (
        <Link to={`/donor/donations/${r.id}`} className="hover:underline">
          {r.foodName}
        </Link>
      )}
      columns={[
        {
          key: 'food',
          header: 'Food',
          cell: (r) => (
            <div>
              <Link to={`/donor/donations/${r.id}`} className="font-medium text-white hover:underline">
                {r.foodName}
              </Link>
              <p className="text-xs text-slate-500">
                {r.category.name} · {DIETARY_LABELS[r.dietaryType]}
              </p>
            </div>
          ),
        },
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
          cell: (r) => (OPEN_STATUSES.includes(r.status) ? <Countdown to={r.pickupDeadline} /> : <span className="text-xs text-slate-400">{formatDateTime(r.pickupDeadline)}</span>),
        },
        { key: 'created', header: 'Listed', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>, hideOnMobile: true },
      ]}
    />
  );
}
