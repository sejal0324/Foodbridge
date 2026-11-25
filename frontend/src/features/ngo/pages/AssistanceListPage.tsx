import { CalendarClock, HandHeart, Plus, Users } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { ButtonLink, Card, EmptyState, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui';
import { useAssistanceRequests } from '@/features/assistance/api';
import { UrgencyBadge } from '@/features/assistance/components/AssistanceRequestCard';
import { formatNumber, formatQuantity, formatRelative, formatWindow } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { AssistanceProgress } from '../components/common';

type Tab = 'open' | 'FULFILLED' | 'closed' | 'all';
const TABS: { value: Tab; label: string; status?: string }[] = [
  { value: 'open', label: 'Open', status: 'OPEN,PARTIALLY_FULFILLED' },
  { value: 'FULFILLED', label: 'Fulfilled', status: 'FULFILLED' },
  { value: 'closed', label: 'Expired or cancelled', status: 'EXPIRED,CANCELLED' },
  { value: 'all', label: 'All' },
];

export default function AssistanceListPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab')) ?? (TABS[0] as (typeof TABS)[number]);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useAssistanceRequests({ page, pageSize: 10, ...(tab.status ? { status: tab.status } : {}) });

  return (
    <>
      <PageHeader
        title="Assistance requests"
        description="Food you asked donors for. Track offers, accept the ones that fit and see what has been received."
        actions={
          <ButtonLink to="/ngo/assistance/new" leftIcon={<Plus className="size-4" aria-hidden="true" />}>
            Ask for food
          </ButtonLink>
        }
      />
      <Card>
        <div className="px-5 pt-3">
          <Tabs label="Request status" value={tab.value} onChange={(v) => setParams(v === 'open' ? {} : { tab: v }, { replace: true })} items={TABS.map(({ value, label }) => ({ value, label }))} />
        </div>
        <div className="p-5">
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <EmptyState
                icon={<HandHeart className="size-6" aria-hidden="true" />}
                title={tab.value === 'open' ? 'No open requests' : 'Nothing here'}
                description="Ask nearby donors for the food you need. Several donors can each cover part of it."
                action={
                  <ButtonLink to="/ngo/assistance/new" size="sm">
                    Ask for food
                  </ButtonLink>
                }
              />
            }
          >
            {(data) => (
              <>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {data.items.map((r) => (
                    <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-white">
                            <Link to={`/ngo/assistance/${r.id}`} className="hover:underline">
                              {formatQuantity(r.quantityRequired, r.unit)} · {r.category.name}
                            </Link>
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {DIETARY_LABELS[r.dietaryRequirement]} · created {formatRelative(r.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <UrgencyBadge urgency={r.urgency} />
                          <StatusBadge status={r.status} />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-4 text-slate-500" aria-hidden="true" />
                          {formatWindow(r.neededFrom, r.neededUntil)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="size-4 text-slate-500" aria-hidden="true" />
                          {formatNumber(r.beneficiariesCount)} people
                        </span>
                      </div>
                      <div className="mt-3">
                        <AssistanceProgress request={r} compact />
                      </div>
                    </li>
                  ))}
                </ul>
                <Pagination
                  className="mt-4"
                  page={data.meta.page}
                  pageSize={data.meta.pageSize}
                  total={data.meta.total}
                  onPageChange={(p) => setParams({ ...(tab.value !== 'open' ? { tab: tab.value } : {}), ...(p > 1 ? { page: String(p) } : {}) }, { replace: true })}
                />
              </>
            )}
          </QueryState>
        </div>
      </Card>
    </>
  );
}
