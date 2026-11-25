import { CheckCircle2, PackageX, UtensilsCrossed, XCircle } from 'lucide-react';
import { ChartFrame, SERIES_COLOURS, SimpleBarChart } from '@/components/charts';
import { Banner, ErrorState, PageHeader, ProgressBar, StatCard } from '@/components/ui';
import { formatMonth, formatNumber, formatPercent } from '@/utils/format';
import { useDonorAnalytics } from '../api';
import { InsightsPanel } from '../components/InsightsPanel';

export default function DonorAnalyticsPage() {
  const query = useDonorAnalytics();
  const a = query.data;
  return (
    <>
      <PageHeader title="Analytics" description="Your donations and verified impact over the last 12 months." />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-6">
          {a && a.dataLabel !== 'REAL' ? <Banner tone="demo">These figures include demo or synthetic records (dataset label: {a.dataLabel.toLowerCase()}).</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Meals redistributed" value={formatNumber(a?.totals.mealsRedistributed)} hint="From two-way verified handovers" icon={<UtensilsCrossed className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Completed collections" value={formatNumber(a?.totals.completedCollections)} icon={<CheckCircle2 className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Failed collections" value={formatNumber(a?.totals.failedCollections)} icon={<XCircle className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Expired donations" value={formatNumber(a?.totals.expiredDonations)} icon={<PackageX className="size-5" aria-hidden="true" />} loading={query.isPending} />
          </div>
          {a ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-white">Collection completion rate</h3>
                  <p className="text-2xl font-semibold text-white tabular-nums">{a.completionRate === null ? '—' : formatPercent(a.completionRate)}</p>
                </div>
                {a.completionRate === null ? (
                  <p className="mt-2 text-sm text-slate-400">No completed or failed collections yet, so there is no rate to show.</p>
                ) : (
                  <ProgressBar className="mt-3" value={Math.round(a.completionRate * 100)} max={100} label="Completion rate" />
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {formatNumber(a.totals.donations)} donations listed · {formatNumber(a.totals.mealsListed)} meals listed · {formatNumber(a.totals.openDonations)} open now
                </p>
              </div>
              <div className="grid gap-6 xl:grid-cols-2">
                <ChartFrame
                  title="Donations listed per month"
                  table={{
                    rows: a.monthly,
                    rowKey: (r) => r.month,
                    columns: [
                      { key: 'm', header: 'Month', cell: (r) => formatMonth(r.month) },
                      { key: 'd', header: 'Donations', align: 'right', cell: (r) => formatNumber(r.donations) },
                    ],
                  }}
                >
                  <SimpleBarChart data={a.monthly} xKey="month" xFormatter={formatMonth} series={[{ key: 'donations', label: 'Donations', colour: SERIES_COLOURS[0] }]} valueFormatter={(v) => formatNumber(v)} />
                </ChartFrame>
                <ChartFrame
                  title="Quantity redistributed per month"
                  description="Units confirmed by both sides at handover"
                  table={{
                    rows: a.monthly,
                    rowKey: (r) => r.month,
                    columns: [
                      { key: 'm', header: 'Month', cell: (r) => formatMonth(r.month) },
                      { key: 'q', header: 'Redistributed', align: 'right', cell: (r) => formatNumber(r.quantityRedistributed) },
                    ],
                  }}
                >
                  <SimpleBarChart data={a.monthly} xKey="month" xFormatter={formatMonth} series={[{ key: 'quantityRedistributed', label: 'Redistributed', colour: SERIES_COLOURS[2] }]} valueFormatter={(v) => formatNumber(v)} />
                </ChartFrame>
              </div>
              <ChartFrame
                title="Donations by category"
                description="Quantity listed per food category"
                height={Math.max(160, a.categories.length * 44)}
                table={{
                  rows: a.categories,
                  rowKey: (r) => r.category,
                  columns: [
                    { key: 'c', header: 'Category', cell: (r) => r.category },
                    { key: 'd', header: 'Donations', align: 'right', cell: (r) => formatNumber(r.donations) },
                    { key: 'q', header: 'Quantity', align: 'right', cell: (r) => formatNumber(r.quantity) },
                  ],
                }}
              >
                {a.categories.length > 0 ? (
                  <SimpleBarChart data={a.categories} xKey="category" layout="vertical" series={[{ key: 'quantity', label: 'Quantity', colour: SERIES_COLOURS[0] }]} valueFormatter={(v) => formatNumber(v)} />
                ) : (
                  <p className="text-sm text-slate-400">No donations yet.</p>
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
