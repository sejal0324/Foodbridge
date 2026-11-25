import { AlertOctagon, Award, BarChart3, HandHeart, IndianRupee, Scale, ShieldCheck, Truck, Users, UtensilsCrossed, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChartFrame, SERIES_COLOURS, SimpleBarChart } from '@/components/charts';
import { Banner, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatCard, statusStyle } from '@/components/ui';
import { formatINR, formatMonth, formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';
import { useAdminAnalytics, useDeadJobCount } from '../api';
import { DataLabelBadge, SectionLink } from '../components/common';
import { GeographicDistributionCard } from '../components/GeographicDistributionCard';
import { MatchingPerformancePanel } from '../components/MatchingPerformancePanel';

export default function AdminOverviewPage() {
  const query = useAdminAnalytics();
  const dead = useDeadJobCount();
  const a = query.data;
  const p = a?.platform;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Live figures for FoodBridge across India, computed from stored records."
        meta={<DataLabelBadge label={a?.dataLabel} />}
      />
      {query.isError ? (
        <ErrorState error={query.error} title="Platform statistics could not be loaded" onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-6">
          {a && a.dataLabel !== 'REAL' ? (
            <Banner tone="demo" title="Demo data present">
              This database contains seeded demo organisations and records, so these figures do not describe real-world activity (dataset label: {a.dataLabel.toLowerCase()}).
            </Banner>
          ) : null}

          <section aria-label="Queues that need attention" className="grid gap-4 sm:grid-cols-3">
            <QueueLink
              to="/admin/verifications"
              label="Pending verifications"
              count={p?.pendingVerifications}
              loading={query.isPending}
              icon={<ShieldCheck className="size-5" aria-hidden="true" />}
              idle="No applications waiting"
            />
            <QueueLink to="/admin/disputes" label="Open disputes" count={p?.openDisputes} loading={query.isPending} icon={<Scale className="size-5" aria-hidden="true" />} idle="No open handover disputes" />
            <QueueLink
              to="/admin/system?jobStatus=DEAD"
              label="Dead background jobs"
              count={dead.isError ? undefined : dead.count}
              loading={dead.isPending}
              icon={<AlertOctagon className="size-5" aria-hidden="true" />}
              idle="All background jobs healthy"
              unavailable={dead.isError}
            />
          </section>

          <section aria-label="Platform figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Donors" value={formatNumber(p?.donors)} hint={p ? `${formatNumber(p.verifiedDonors)} verified` : undefined} icon={<UtensilsCrossed className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="NGOs" value={formatNumber(p?.ngos)} hint={p ? `${formatNumber(p.verifiedNgos)} verified` : undefined} icon={<Users className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Meals redistributed" value={formatNumber(p?.mealsRedistributed)} hint="Two-way confirmed handovers (meals only)" icon={<UtensilsCrossed className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Successful handovers" value={formatNumber(p?.successfulHandovers)} hint="Confirmed by both donor and NGO" icon={<Truck className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Assistance requests" value={formatNumber(p?.assistanceRequests)} hint="Raised by NGOs, all time" icon={<HandHeart className="size-5" aria-hidden="true" />} loading={query.isPending} />
            <StatCard label="Failed pickups" value={formatNumber(p?.failedPickups)} hint="No-shows and failed collections" icon={<XCircle className="size-5" aria-hidden="true" />} loading={query.isPending} />
          </section>

          {a ? (
            <>
              <div className="grid gap-6 xl:grid-cols-2">
                <ChartFrame
                  title="Donations and assistance requests per month"
                  description="Last 12 months (counts)"
                  legend={[
                    { label: 'Donations listed', colour: SERIES_COLOURS[0], kind: 'bar' },
                    { label: 'Assistance requests', colour: SERIES_COLOURS[1], kind: 'bar' },
                  ]}
                  table={{
                    rows: a.monthly,
                    rowKey: (r) => r.month,
                    columns: [
                      { key: 'm', header: 'Month', cell: (r) => formatMonth(r.month) },
                      { key: 'd', header: 'Donations', align: 'right', cell: (r) => formatNumber(r.donations) },
                      { key: 'a', header: 'Assistance requests', align: 'right', cell: (r) => formatNumber(r.assistanceRequests) },
                    ],
                  }}
                >
                  <SimpleBarChart
                    data={a.monthly}
                    xKey="month"
                    xFormatter={formatMonth}
                    series={[
                      { key: 'donations', label: 'Donations listed', colour: SERIES_COLOURS[0] },
                      { key: 'assistanceRequests', label: 'Assistance requests', colour: SERIES_COLOURS[1] },
                    ]}
                    valueFormatter={(v) => formatNumber(v)}
                  />
                </ChartFrame>
                <ChartFrame
                  title="Quantity redistributed per month"
                  description="Units confirmed by both sides at handover (meals, packets and boxes)"
                  table={{
                    rows: a.monthly,
                    rowKey: (r) => r.month,
                    columns: [
                      { key: 'm', header: 'Month', cell: (r) => formatMonth(r.month) },
                      { key: 'q', header: 'Units redistributed', align: 'right', cell: (r) => formatNumber(r.quantityRedistributed) },
                    ],
                  }}
                >
                  <SimpleBarChart data={a.monthly} xKey="month" xFormatter={formatMonth} series={[{ key: 'quantityRedistributed', label: 'Units redistributed', colour: SERIES_COLOURS[2] }]} valueFormatter={(v) => formatNumber(v)} />
                </ChartFrame>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <GeographicDistributionCard rows={a.geographicDistribution} />
                <ChartFrame
                  title="Donations by status"
                  description="All donations ever listed"
                  height={Math.max(180, a.donationsByStatus.length * 40)}
                  table={{
                    rows: a.donationsByStatus,
                    rowKey: (r) => r.status,
                    columns: [
                      { key: 's', header: 'Status', cell: (r) => statusStyle(r.status).label },
                      { key: 'c', header: 'Donations', align: 'right', cell: (r) => formatNumber(r.count) },
                    ],
                  }}
                >
                  {a.donationsByStatus.length > 0 ? (
                    <SimpleBarChart
                      data={a.donationsByStatus.map((r) => ({ ...r, label: statusStyle(r.status).label }))}
                      xKey="label"
                      layout="vertical"
                      series={[{ key: 'count', label: 'Donations', colour: SERIES_COLOURS[0] }]}
                      valueFormatter={(v) => formatNumber(v)}
                    />
                  ) : (
                    <p className="text-sm text-slate-400">No donations yet.</p>
                  )}
                </ChartFrame>
              </div>

              <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
                <Card>
                  <CardHeader title="Service-fee revenue" description="NGO fees (₹5 per verified unit); donors are never charged." icon={<IndianRupee className="size-4" aria-hidden="true" />} actions={<SectionLink to="/admin/billing">Billing</SectionLink>} />
                  <CardBody>
                    <dl className="space-y-3">
                      <MoneyRow label="Billed" value={a.serviceFeeRevenue.billed} hint="All non-void fee lines" />
                      <MoneyRow label="Collected" value={a.serviceFeeRevenue.collected} hint="Payments received, including partial and offline payments" />
                      <MoneyRow label="Outstanding" value={a.serviceFeeRevenue.outstanding} hint="Not yet invoiced or awaiting payment" />
                    </dl>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Rewards" description="Points credited to donors for verified handovers." icon={<Award className="size-4" aria-hidden="true" />} actions={<SectionLink to="/admin/rewards">Rewards</SectionLink>} />
                  <CardBody>
                    <dl className="grid grid-cols-2 gap-4">
                      <div>
                        <dt className="text-sm text-slate-400">Points credited</dt>
                        <dd className="mt-1 text-2xl font-semibold text-white tabular-nums">{formatNumber(a.rewards.pointsCredited)}</dd>
                      </div>
                      <div>
                        <dt className="text-sm text-slate-400">Donors rewarded</dt>
                        <dd className="mt-1 text-2xl font-semibold text-white tabular-nums">{formatNumber(a.rewards.donorsRewarded)}</dd>
                      </div>
                    </dl>
                  </CardBody>
                </Card>
                <Card className="lg:col-span-2 xl:col-span-1">
                  <CardHeader title="Matching performance" description="Weighted ranking runs and partner responses." icon={<BarChart3 className="size-4" aria-hidden="true" />} actions={<SectionLink to="/admin/ai">AI performance</SectionLink>} />
                  <CardBody>
                    <MatchingPerformancePanel data={a.matching} />
                  </CardBody>
                </Card>
              </div>
            </>
          ) : (
            <div className="grid gap-6 xl:grid-cols-2">
              <Skeleton className="h-80 w-full rounded-2xl" />
              <Skeleton className="h-80 w-full rounded-2xl" />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function QueueLink({ to, label, count, loading, icon, idle, unavailable }: { to: string; label: string; count: number | undefined; loading: boolean; icon: ReactNode; idle: string; unavailable?: boolean }) {
  const needsAttention = (count ?? 0) > 0;
  return (
    <Link
      to={to}
      className={cn(
        'group rounded-2xl border bg-surface p-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
        needsAttention ? 'border-amber-400/40 hover:border-amber-300/60' : 'border-white/10 hover:border-white/20',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-400">{label}</p>
        <span className={needsAttention ? 'text-amber-300' : 'text-slate-500'}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{unavailable ? '—' : formatNumber(count)}</p>
      )}
      <p className="mt-1 text-xs text-slate-400 group-hover:text-slate-300">{unavailable ? 'Count unavailable' : needsAttention ? 'Open the queue →' : idle}</p>
    </Link>
  );
}

function MoneyRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <dt className="text-sm text-slate-200">{label}</dt>
        <dd className="text-xs text-slate-500">{hint}</dd>
      </div>
      <dd className="text-lg font-semibold text-white tabular-nums">{formatINR(Number(value))}</dd>
    </div>
  );
}
