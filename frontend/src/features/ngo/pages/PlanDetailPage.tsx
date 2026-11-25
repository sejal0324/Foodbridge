import { useState } from 'react';
import { useParams } from 'react-router';
import { Button, ConfirmDialog, ErrorState, LoadingState, PageHeader, StatusBadge, useToast } from '@/components/ui';
import { formatDate } from '@/utils/format';
import { useCollectionPlan, useSetPlanStatus } from '../api';
import { PlanDetailView } from '../components/PlanDetailView';

type Target = 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
const COPY: Record<Target, { title: string; body: string; label: string; done: string }> = {
  CONFIRMED: { title: 'Confirm this plan?', body: 'Marks the route as the plan for this trip. Pickups still need the usual verification at each donor.', label: 'Confirm plan', done: 'Plan confirmed' },
  COMPLETED: { title: 'Mark this plan as completed?', body: 'Use this when the trip is over. Each collection is still completed by its own handover and delivery confirmation.', label: 'Mark completed', done: 'Plan completed' },
  CANCELLED: { title: 'Cancel this plan?', body: 'The plan is kept for reference but no longer active. The collections themselves are not cancelled.', label: 'Cancel plan', done: 'Plan cancelled' },
};

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useCollectionPlan(id);
  const setStatus = useSetPlanStatus(id ?? '');
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  if (query.isPending) return <LoadingState label="Loading plan…" />;
  if (query.isError) return <ErrorState error={query.error} title="This plan could not be loaded" onRetry={() => void query.refetch()} />;
  const plan = query.data;
  const actions: Target[] = plan.status === 'DRAFT' ? ['CONFIRMED', 'CANCELLED'] : ['CONFIRMED', 'IN_PROGRESS'].includes(plan.status) ? ['COMPLETED', 'CANCELLED'] : [];

  return (
    <>
      <PageHeader
        title={`Collection plan · ${formatDate(plan.planDate)}`}
        back={{ to: '/ngo/planning', label: 'Route planning' }}
        meta={<StatusBadge status={plan.status} />}
        actions={
          actions.length > 0 ? (
            <>
              {actions.map((a) => (
                <Button key={a} variant={a === 'CANCELLED' ? 'ghost' : 'primary'} onClick={() => setTarget(a)}>
                  {COPY[a].label}
                </Button>
              ))}
            </>
          ) : null
        }
      />
      <PlanDetailView plan={plan} />
      {target ? (
        <ConfirmDialog
          open
          onClose={() => setTarget(null)}
          title={COPY[target].title}
          description={COPY[target].body}
          confirmLabel={COPY[target].label}
          tone={target === 'CANCELLED' ? 'danger' : 'primary'}
          loading={setStatus.isPending}
          onConfirm={() =>
            setStatus
              .mutateAsync(target)
              .then(() => {
                toast.success(COPY[target].done);
                setTarget(null);
              })
              .catch((e: unknown) => toast.error(e))
          }
        />
      ) : null}
    </>
  );
}
