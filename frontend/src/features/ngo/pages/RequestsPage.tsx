import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Button, ButtonLink, Card, ConfirmDialog, Countdown, DataTable, EmptyState, PageHeader, Pagination, StatusBadge, Tabs, useToast } from '@/components/ui';
import { useDonationRequests } from '@/features/donations/api';
import type { DonationRequest } from '@/types';
import { formatQuantity, formatRelative } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { useWithdrawRequest } from '../api';

type Tab = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
const TABS: { value: Tab; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

export default function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('status'))?.value ?? 'ALL') as Tab;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useDonationRequests({ page, pageSize: 20, ...(tab !== 'ALL' ? { status: tab } : {}) });
  const [withdrawing, setWithdrawing] = useState<DonationRequest | null>(null);

  return (
    <>
      <PageHeader
        title="My requests"
        description="Food you requested from donors' listings. Approved requests become collections you assign a representative to."
        actions={
          <ButtonLink to="/ngo/marketplace" variant="outline">
            Browse the marketplace
          </ButtonLink>
        }
      />
      <Card>
        <div className="px-5 pt-3">
          <Tabs label="Request status" value={tab} onChange={(v) => setParams(v === 'ALL' ? {} : { status: v }, { replace: true })} items={TABS} />
        </div>
        <div className="p-5">
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <EmptyState
                icon={<ClipboardList className="size-6" aria-hidden="true" />}
                title={tab === 'ALL' ? 'No requests yet' : `No ${tab.toLowerCase()} requests`}
                description="Request food from the marketplace; the donor approves or rejects it."
                action={
                  <ButtonLink to="/ngo/marketplace" size="sm">
                    Browse the marketplace
                  </ButtonLink>
                }
              />
            }
          >
            {(data) => (
              <>
                <DataTable
                  caption="Donation requests"
                  rows={data.items}
                  rowKey={(r) => r.id}
                  mobileTitle={(r) => (
                    <Link to={`/ngo/marketplace/${r.donation.id}`} className="hover:underline">
                      {r.donation.foodName}
                    </Link>
                  )}
                  columns={[
                    {
                      key: 'food',
                      header: 'Food',
                      cell: (r) => (
                        <div>
                          <Link to={`/ngo/marketplace/${r.donation.id}`} className="font-medium text-white hover:underline">
                            {r.donation.foodName}
                          </Link>
                          <p className="text-xs text-slate-400">{DIETARY_LABELS[r.donation.dietaryType]}</p>
                        </div>
                      ),
                    },
                    { key: 'donor', header: 'Donor', cell: (r) => r.donation.donorName },
                    {
                      key: 'qty',
                      header: 'Quantity',
                      cell: (r) => (
                        <span>
                          {formatQuantity(r.requestedQuantity, r.donation.unit)}
                          {r.approvedQuantity !== null && r.approvedQuantity !== r.requestedQuantity ? <span className="block text-xs text-slate-400">approved {r.approvedQuantity}</span> : null}
                        </span>
                      ),
                    },
                    { key: 'when', header: 'Requested', cell: (r) => formatRelative(r.createdAt) },
                    { key: 'deadline', header: 'Pickup deadline', cell: (r) => (['PENDING', 'APPROVED'].includes(r.status) ? <Countdown to={r.donation.pickupDeadline} /> : '—') },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (r) => (
                        <div>
                          <StatusBadge status={r.status} />
                          {r.decisionReason ? <p className="mt-0.5 text-xs text-slate-400">{r.decisionReason}</p> : null}
                        </div>
                      ),
                    },
                    {
                      key: 'actions',
                      header: <span className="sr-only">Actions</span>,
                      align: 'right',
                      cell: (r) =>
                        r.status === 'PENDING' ? (
                          <Button size="sm" variant="ghost" onClick={() => setWithdrawing(r)}>
                            Withdraw
                          </Button>
                        ) : r.status === 'APPROVED' ? (
                          <ButtonLink to="/ngo/collections" size="sm" variant="outline">
                            Collection
                          </ButtonLink>
                        ) : null,
                    },
                  ]}
                />
                <Pagination className="mt-4" page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => setParams({ ...(tab !== 'ALL' ? { status: tab } : {}), ...(p > 1 ? { page: String(p) } : {}) }, { replace: true })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
      {withdrawing ? <WithdrawDialog request={withdrawing} onClose={() => setWithdrawing(null)} /> : null}
    </>
  );
}

function WithdrawDialog({ request, onClose }: { request: DonationRequest; onClose: () => void }) {
  const withdraw = useWithdrawRequest();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Withdraw this request?"
      description={`${request.donation.donorName} will no longer see your request for ${formatQuantity(request.requestedQuantity, request.donation.unit)} of ${request.donation.foodName}.`}
      confirmLabel="Withdraw request"
      tone="danger"
      loading={withdraw.isPending}
      onConfirm={() =>
        withdraw
          .mutateAsync(request.id)
          .then(() => {
            toast.success('Request withdrawn');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    />
  );
}
