import { CheckCircle2, Clock, PackageCheck, Users, UtensilsCrossed, XCircle } from 'lucide-react';
import { ChartFrame, SERIES_COLOURS, SimpleBarChart } from '@/components/charts';
import { Banner, ErrorState, PageHeader, ProgressBar, StatCard } from '@/components/ui';
import { InsightsPanel } from '@/features/analytics';
import { formatDuration, formatINR, formatMonth, formatNumber } from '@/utils/format';
import { useNgoAnalytics } from '../api';

const REQUEST_STATUS_LABEL: Record<string, string> = { OPEN: 'Open', PARTIALLY_FULFILLED: 'Partially fulfilled', FULFILLED: 'Fulfilled', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };

export default function AnalyticsPage() {
  const query = useNgoAnalytics();
  const a = query.data;
  const byStatus = a ? Object.entries(a.assistanceRequestsByStatus).map(([status, count]) => ({ status: REQUEST_STATUS_LABEL[status] ?? status, count })) : [];
  const perf = a?.collectionPerformance;

  return (
    <>
      <PageHeader title="Analytics" description="Food your NGO received and delivered over the last 12 months, from confirmed handovers and deliveries." />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-6">
          {a && a.dataLabel !== 'REAL' ? <Banner tone="demo">These figures include demo or synthetic records (dataset label: {a.dataLabel.toLowerCase()}).</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Meals received" value={formatNumber(a?.totals.mealsReceived)} hint="Quantity confirmed by both sides" icon={<UtensilsCrossed className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Delivered" value={formatNumber(a?.totals.quantityDelivered)} hint="Units confirmed at delivery" icon={<PackageCheck className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="People served" value={formatNumber(a?.totals.beneficiariesServed)} hint="Reported at delivery" icon={<Users className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard
              label="Assignment to handover"
              value={perf?.averageMinutesAssignmentToHandover === null || perf?.averageMinutesAssignmentToHandover === undefined ? '—' : formatDuration(perf.averageMinutesAssignmentToHandover * 60)}
              hint={perf ? (perf.sampleSize > 0 ? `Average over ${perf.sampleSize} handover${perf.sampleSize === 1 ? '' : 's'}${perf.sampleSize < 5 ? ' (small sample)' : ''}` : 'No handovers yet') : undefined}
              icon={<Clock className="size-5" aria-hidden="true" />}
              loading={query.isPending}
            />
          </div>

          {a ? (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-surface p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold text-white">Collection success rate</h3>
                    <p className="text-2xl font-semibold text-white tabular-nums">{a.successfulCollectionRate === null ? '—' : `${formatNumber(a.successfulCollectionRate)}%`}</p>
                  </div>
                  {a.successfulCollectionRate === null ? (
                    <p className="mt-2 text-sm text-slate-400">No completed, cancelled or expired collections yet, so there is no rate to show.</p>
                  ) : (
                    <ProgressBar className="mt-3" value={Math.round(a.successfulCollectionRate)} max={100} label="Collection success rate" />
                  )}
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="flex items-center gap-1 text-slate-400">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" /> Completed
                      </dt>
                      <dd className="font-semibold text-white tabular-nums">{formatNumber(a.totals.completedCollections)}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-slate-400">
                        <XCircle className="size-3.5" aria-hidden="true" /> Cancelled or expired
                      </dt>
                      <dd className="font-semibold text-white tabular-nums">{formatNumber(a.totals.failedCollections)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Active now</dt>
                      <dd className="font-semibold text-white tabular-nums">{formatNumber(a.totals.activeCollections)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="rounded-2xl border border-white/10 bg-surface p-5">
                  <h3 className="text-base font-semibold text-white">Service fees</h3>
                  <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-400">Billed in total</dt>
                      <dd className="text-lg font-semibold text-white tabular-nums">{formatINR(a.fees.totalBilled)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Outstanding</dt>
                      <dd className="text-lg font-semibold text-white tabular-nums">{formatINR(a.fees.outstanding)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">This month</dt>
                      <dd className="text-lg font-semibold text-white tabular-nums">{formatINR(a.fees.thisMonth)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-slate-500">Fees apply only to quantities confirmed by both sides at handover.</p>
                </div>
              </div>

              <ChartFrame
                title="Received vs requested per month"
                description="Requested: quantity in your assistance requests. Received: quantity confirmed at handover (all units)."
                legend={[
                  { label: 'Requested', colour: SERIES_COLOURS[0] as string, kind: 'bar' },
                  { label: 'Received', colour: SERIES_COLOURS[2] as string, kind: 'bar' },
                ]}
                table={{
                  rows: a.monthly,
                  rowKey: (r) => r.month,
                  columns: [
                    { key: 'm', header: 'Month', cell: (r) => formatMonth(r.month) },
                    { key: 'q', header: 'Requested', align: 'right', cell: (r) => formatNumber(r.quantityRequested) },
                    { key: 'r', header: 'Received', align: 'right', cell: (r) => formatNumber(r.quantityReceived) },
                  ],
                }}
              >
                <SimpleBarChart
                  data={a.monthly}
                  xKey="month"
                  xFormatter={formatMonth}
                  series={[
                    { key: 'quantityRequested', label: 'Requested', colour: SERIES_COLOURS[0] },
                    { key: 'quantityReceived', label: 'Received', colour: SERIES_COLOURS[2] },
                  ]}
                  valueFormatter={(v) => formatNumber(v)}
                />
              </ChartFrame>

              <ChartFrame
                title="Assistance requests by status"
                height={Math.max(140, byStatus.length * 44)}
                table={{
                  rows: byStatus,
                  rowKey: (r) => r.status,
                  columns: [
                    { key: 's', header: 'Status', cell: (r) => r.status },
                    { key: 'c', header: 'Requests', align: 'right', cell: (r) => formatNumber(r.count) },
                  ],
                }}
              >
                {byStatus.length > 0 ? (
                  <SimpleBarChart data={byStatus} xKey="status" layout="vertical" series={[{ key: 'count', label: 'Requests', colour: SERIES_COLOURS[0] }]} valueFormatter={(v) => formatNumber(v)} />
                ) : (
                  <p className="text-sm text-slate-400">No assistance requests yet.</p>
                )}
              </ChartFrame>
            </>
          ) : null}
          <InsightsPanel />
        </div>
      )}
    </>
  );
}
