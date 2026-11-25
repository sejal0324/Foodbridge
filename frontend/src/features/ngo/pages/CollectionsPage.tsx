import { PackageCheck, Route } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Button, ButtonLink, Card, ConfirmDialog, Countdown, DataTable, EmptyState, Field, PageHeader, Pagination, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { useAllocations, useCancelAllocation } from '@/features/donations/api';
import type { Allocation } from '@/types';
import { formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { AssignRepresentativeDialog } from '../components/AssignRepresentativeDialog';

type Tab = 'RESERVED' | 'PICKUP_ASSIGNED' | 'all';
const TABS: { value: Tab; label: string }[] = [
  { value: 'RESERVED', label: 'Needs a representative' },
  { value: 'PICKUP_ASSIGNED', label: 'Assigned' },
  { value: 'all', label: 'All collections' },
];
const SOURCE_LABEL: Record<string, string> = { DONATION_REQUEST: 'Marketplace request', ASSISTANCE_OFFER: 'Assistance offer' };

/** Allocations can be (re)assigned while reserved or assigned, as long as verification has not started. */
function canAssign(a: Allocation): boolean {
  if (a.status === 'RESERVED') return true;
  return a.status === 'PICKUP_ASSIGNED' && (!a.pickup || ['ASSIGNED', 'EN_ROUTE'].includes(a.pickup.status));
}

export default function CollectionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'RESERVED') as Tab;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useAllocations({ page, pageSize: 20, ...(tab !== 'all' ? { status: tab } : {}) });
  const [assigning, setAssigning] = useState<Allocation | null>(null);
  const [cancelling, setCancelling] = useState<Allocation | null>(null);

  return (
    <>
      <PageHeader
        title="Collections"
        description="Food reserved for your NGO. Assign a representative to each one before its pickup deadline; reassign if plans change before verification starts."
        actions={
          <ButtonLink to="/ngo/planning" variant="outline" leftIcon={<Route className="size-4" aria-hidden="true" />}>
            Plan a route
          </ButtonLink>
        }
      />
      <Card>
        <div className="px-5 pt-3">
          <Tabs label="Collection status" value={tab} onChange={(v) => setParams(v === 'RESERVED' ? {} : { tab: v }, { replace: true })} items={TABS} />
        </div>
        <div className="p-5">
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <EmptyState
                icon={<PackageCheck className="size-6" aria-hidden="true" />}
                title={tab === 'RESERVED' ? 'Nothing waiting for a representative' : 'No collections here'}
                description="Collections appear when a donor approves your request or confirms an offer you accepted."
              />
            }
          >
            {(data) => (
              <>
                <DataTable
                  caption="Collections"
                  rows={data.items}
                  rowKey={(a) => a.id}
                  columns={[
                    {
                      key: 'food',
                      header: 'Food',
                      cell: (a) => (
                        <div>
                          <p className="font-medium text-white">{a.foodName}</p>
                          <p className="text-xs text-slate-400">
                            {DIETARY_LABELS[a.dietaryType]} · {SOURCE_LABEL[a.source] ?? a.source}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: 'donor',
                      header: 'Donor',
                      cell: (a) => (
                        <div>
                          <p>{a.donor.name}</p>
                          <p className="text-xs text-slate-400">{a.address}</p>
                        </div>
                      ),
                    },
                    { key: 'qty', header: 'Quantity', cell: (a) => (a.handedOverQuantity !== null ? `${formatQuantity(a.handedOverQuantity, a.unit)} handed over` : formatQuantity(a.quantity, a.unit)) },
                    { key: 'deadline', header: 'Pickup deadline', cell: (a) => (['RESERVED', 'PICKUP_ASSIGNED'].includes(a.status) ? <Countdown to={a.pickupDeadline} /> : '—') },
                    { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
                    {
                      key: 'pickup',
                      header: 'Pickup',
                      cell: (a) =>
                        a.pickup ? (
                          <Link to={`/ngo/pickups/${a.pickup.id}`} className="inline-flex items-center gap-2 text-brand-300 hover:underline">
                            Open <StatusBadge status={a.pickup.status} />
                          </Link>
                        ) : (
                          <span className="text-slate-500">Not assigned</span>
                        ),
                    },
                    {
                      key: 'actions',
                      header: <span className="sr-only">Actions</span>,
                      align: 'right',
                      cell: (a) => (
                        <div className="flex flex-wrap justify-end gap-2">
                          {canAssign(a) ? (
                            <Button size="sm" variant={a.status === 'RESERVED' ? 'primary' : 'outline'} onClick={() => setAssigning(a)}>
                              {a.status === 'RESERVED' ? 'Assign' : 'Reassign'}
                            </Button>
                          ) : null}
                          {['RESERVED', 'PICKUP_ASSIGNED'].includes(a.status) ? (
                            <Button size="sm" variant="ghost" onClick={() => setCancelling(a)}>
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      ),
                    },
                  ]}
                />
                <Pagination className="mt-4" page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => setParams({ ...(tab !== 'RESERVED' ? { tab } : {}), ...(p > 1 ? { page: String(p) } : {}) }, { replace: true })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
      {assigning ? <AssignRepresentativeDialog allocation={assigning} onClose={() => setAssigning(null)} /> : null}
      {cancelling ? <CancelAllocationDialog allocation={cancelling} onClose={() => setCancelling(null)} /> : null}
    </>
  );
}

function CancelAllocationDialog({ allocation, onClose }: { allocation: Allocation; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useCancelAllocation();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone="danger"
      title="Cancel this collection?"
      description={`The ${formatQuantity(allocation.quantity, allocation.unit)} reserved for you are released back to ${allocation.donor.name}, and any assigned pickup is cancelled. Nothing is charged.`}
      confirmLabel="Cancel collection"
      cancelLabel="Keep it"
      confirmDisabled={reason.trim().length < 3}
      loading={cancel.isPending}
      onConfirm={() =>
        cancel
          .mutateAsync({ allocationId: allocation.id, reason: reason.trim() })
          .then(() => {
            toast.success('Collection cancelled', 'The donor has been notified.');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason" hint="At least 3 characters; shared with the donor." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
