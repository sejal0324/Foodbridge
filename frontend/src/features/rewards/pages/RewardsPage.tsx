import { Award, Download, FileBadge, Medal, TrendingUp, Trophy } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, ProgressBar, Select, Skeleton, StatCard, Switch, useToast } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { useDonorProfile, useUpdateDonorProfile } from '@/features/profile/api';
import type { RewardBalance, RewardTransaction } from '@/types';
import { cn } from '@/utils/cn';
import { formatDate, formatDateTime, formatMonth, formatNumber, formatQuantity, todayIst } from '@/utils/format';
import { downloadCertificate, useCertificates, useIssueCertificate, useLeaderboard, useRewardBalance, useRewardHistory } from '../api';

export default function RewardsPage() {
  const balance = useRewardBalance();
  return (
    <>
      <PageHeader title="Rewards" description="Points for every verified handover, impact certificates and the monthly leaderboard." />
      <div className="space-y-6">
        {balance.isError ? <ErrorState error={balance.error} onRetry={() => void balance.refetch()} /> : <BalanceSection balance={balance.data} loading={balance.isPending} />}
        <RulesCard balance={balance.data} />
        <div className="grid gap-6 xl:grid-cols-2">
          <HistoryCard />
          <div className="space-y-6">
            <LeaderboardCard />
            <CertificatesCard />
          </div>
        </div>
      </div>
    </>
  );
}

function BalanceSection({ balance, loading }: { balance?: RewardBalance; loading: boolean }) {
  const next = balance?.nextTier;
  const upgrade = balance?.nextRateUpgrade;
  const mealRules = (balance?.rules ?? []).filter((r) => r.unit === 'MEALS' && r.basis === 'PER_UNIT').sort((a, b) => a.lifetimeThreshold - b.lifetimeThreshold);
  const currentRate = [...mealRules].reverse().find((r) => r.lifetimeThreshold <= (balance?.lifetimeMeals ?? 0))?.points;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Points balance" value={formatNumber(balance?.balance)} icon={<Award className="size-5" aria-hidden="true" />} loading={loading} />
      <StatCard label="Lifetime points" value={formatNumber(balance?.lifetimePoints)} loading={loading} hint={balance ? `${formatNumber(balance.lifetimeOrders)} verified handovers` : undefined} />
      <div className="rounded-2xl border border-white/10 bg-surface p-5">
        <p className="text-sm text-slate-400">Tier</p>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-24" />
        ) : (
          <>
            <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
              <Medal className="size-6 text-amber-300" aria-hidden="true" />
              {balance?.tier?.name ? balance.tier.name.charAt(0) + balance.tier.name.slice(1).toLowerCase() : 'None yet'}
            </p>
            {balance?.tier?.benefits ? <p className="mt-1 text-xs text-slate-400">{balance.tier.benefits}</p> : null}
            {next ? (
              <div className="mt-3">
                <ProgressBar value={balance.lifetimePoints} max={balance.lifetimePoints + next.pointsNeeded} label={`Progress to ${next.name}`} />
                <p className="mt-1 text-xs text-slate-400">
                  {formatNumber(next.pointsNeeded)} points to {next.name.charAt(0) + next.name.slice(1).toLowerCase()}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="rounded-2xl border border-white/10 bg-surface p-5">
        <p className="text-sm text-slate-400">Meal rate</p>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-24" />
        ) : (
          <>
            <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
              <TrendingUp className="size-6 text-brand-300" aria-hidden="true" />
              {currentRate ?? '—'} <span className="text-sm font-normal text-slate-400">points / meal</span>
            </p>
            {upgrade && balance ? (
              <div className="mt-3">
                <ProgressBar value={balance.lifetimeMeals} max={balance.lifetimeMeals + upgrade.mealsNeeded} label="Progress to the higher meal rate" />
                <p className="mt-1 text-xs text-slate-300">
                  <strong className="text-white">{formatNumber(upgrade.mealsNeeded)}</strong> {upgrade.mealsNeeded === 1 ? 'meal' : 'meals'} until {upgrade.pointsPerMeal} points/meal
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400">You have reached the highest meal rate.</p>
            )}
            <p className="mt-1 text-xs text-slate-500">{formatNumber(balance?.lifetimeMeals)} verified meals so far</p>
          </>
        )}
      </div>
    </div>
  );
}

function RulesCard({ balance }: { balance?: RewardBalance }) {
  const rules = balance?.rules ?? [];
  const mealRules = rules.filter((r) => r.unit === 'MEALS' && r.basis === 'PER_UNIT').sort((a, b) => a.lifetimeThreshold - b.lifetimeThreshold);
  const orderRules = rules.filter((r) => r.basis === 'PER_ORDER');
  return (
    <Card>
      <CardHeader title="How points are earned" icon={<Award className="size-4" aria-hidden="true" />} />
      <CardBody>
        <ul className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
          <li className="rounded-xl border border-white/10 p-4">
            <strong className="text-white">10 points per verified meal</strong>, from your first meal.
          </li>
          <li className="rounded-xl border border-white/10 p-4">
            <strong className="text-white">15 points per meal after 500 lifetime verified meals.</strong> A handover that crosses 500 is split: meals up to 500 earn 10, the rest earn 15.
          </li>
          <li className="rounded-xl border border-white/10 p-4">
            <strong className="text-white">10 points per verified packet or box order</strong>, whatever the number of packets or boxes in it.
          </li>
          <li className="rounded-xl border border-white/10 p-4">
            <strong className="text-white">Only two-way verified handovers count.</strong> Points are credited when the donor and the NGO confirm the same quantity; nothing is earned for listings,
            reservations, forecasts or disputed handovers.
          </li>
        </ul>
        {rules.length > 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Active rules: {mealRules.map((r) => `${r.points} pts/meal${r.lifetimeThreshold > 0 ? ` after ${r.lifetimeThreshold} meals` : ''}`).join(', ')}
            {orderRules.length > 0 ? `; ${orderRules.map((r) => `${r.points} pts per ${r.unit.toLowerCase().replace(/s$/, '')} order`).join(', ')}` : ''}.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function HistoryCard() {
  const [page, setPage] = useState(1);
  const query = useRewardHistory(page);
  return (
    <Card>
      <CardHeader title="Points history" description="Every credit and adjustment, with how it was calculated." />
      <CardBody>
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title="No points yet" description="Points appear after your first two-way verified handover." />}>
          {(data) => (
            <div className="space-y-4">
              <ul className="divide-y divide-white/5">
                {data.items.map((t) => (
                  <HistoryItem key={t.id} t={t} />
                ))}
              </ul>
              <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={setPage} />
            </div>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function HistoryItem({ t }: { t: RewardTransaction }) {
  const positive = t.points >= 0;
  return (
    <li className="py-3 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            {t.description ?? (t.referenceType === 'HANDOVER' && t.quantity !== null && t.unit ? `Verified handover of ${formatQuantity(t.quantity, t.unit)}` : t.type.replace(/_/g, ' ').toLowerCase())}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className={cn('text-sm font-semibold tabular-nums', positive ? 'text-emerald-300' : 'text-red-300')}>
            {positive ? '+' : ''}
            {formatNumber(t.points)}
          </p>
          <p className="text-xs text-slate-500 tabular-nums">balance {formatNumber(t.balanceAfter)}</p>
        </div>
      </div>
      {t.calculation?.lines && t.calculation.lines.length > 0 ? (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
          {t.calculation.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{l.description}</span>
              <span className="text-slate-300 tabular-nums">{l.points} pts</span>
            </li>
          ))}
          {t.calculation.lifetimeMealsBefore !== undefined ? <li className="pt-1 text-slate-500">Lifetime meals before this handover: {formatNumber(t.calculation.lifetimeMealsBefore)}</li> : null}
        </ul>
      ) : null}
    </li>
  );
}

function monthOptions(): { value: string; label: string }[] {
  const [y, m] = todayIst().split('-').map(Number) as [number, number];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { value, label: i === 0 ? `This month (${formatMonth(value)})` : formatMonth(value) };
  });
}

function LeaderboardCard() {
  const options = monthOptions();
  const [month, setMonth] = useState(options[0]?.value ?? '');
  const query = useLeaderboard(month);
  const profile = useDonorProfile();
  const update = useUpdateDonorProfile();
  const toast = useToast();
  return (
    <Card>
      <CardHeader
        title="Monthly leaderboard"
        icon={<Trophy className="size-4" aria-hidden="true" />}
        actions={
          <Field label="Month" hideLabel className="w-48">
            <Select value={month} onChange={(e) => setMonth(e.target.value)} options={options} />
          </Field>
        }
      />
      <CardBody className="space-y-4">
        <QueryState query={query} empty={<EmptyState compact title="No verified handovers this month yet" />}>
          {(rows) => (
            <DataTable
              caption="Leaderboard"
              rows={rows}
              rowKey={(r) => `${r.rank}`}
              columns={[
                { key: 'rank', header: '#', cell: (r) => <span className="tabular-nums">{r.rank}</span> },
                {
                  key: 'name',
                  header: 'Donor',
                  cell: (r) => (
                    <span className={r.isYou ? 'font-semibold text-white' : undefined}>
                      {r.donorName} {r.isYou ? <Badge tone="brand">You</Badge> : null}
                    </span>
                  ),
                },
                { key: 'meals', header: 'Meals', align: 'right', cell: (r) => formatNumber(r.mealsRedistributed) },
                { key: 'points', header: 'Points', align: 'right', cell: (r) => formatNumber(r.points) },
              ]}
            />
          )}
        </QueryState>
        <div className="rounded-xl border border-white/10 p-4">
          {profile.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : profile.data ? (
            <Switch
              checked={profile.data.publicRecognitionConsent}
              disabled={update.isPending}
              onChange={(v) =>
                update.mutate(
                  { publicRecognitionConsent: v },
                  { onSuccess: () => toast.success(v ? 'Your name will be shown publicly' : 'You will appear as “Anonymous donor”'), onError: (e) => toast.error(e) },
                )
              }
              label="Show my business name publicly"
              description="Off by default. Other donors see “Anonymous donor” unless you opt in."
            />
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function CertificatesCard() {
  const user = useCurrentUser();
  const certificates = useCertificates();
  const issue = useIssueCertificate();
  const toast = useToast();
  const today = todayIst();
  const [start, setStart] = useState(`${today.slice(0, 7)}-01`);
  const [end, setEnd] = useState(today);
  const [downloading, setDownloading] = useState<string | null>(null);
  const invalid = !start || !end || end < start;
  return (
    <Card>
      <CardHeader title="Impact certificates" description="Generated from your verified ledger for any period." icon={<FileBadge className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-5">
        {isOrganisationApproved(user) ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (invalid) return;
              issue.mutate(
                { periodStart: start, periodEnd: end },
                { onSuccess: (c) => toast.success('Certificate ready', `${c.certificateNumber}: ${formatNumber(c.mealsRedistributed)} meals`), onError: (err) => toast.error(err) },
              );
            }}
          >
            <Field label="From" className="w-40">
              <Input type="date" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="To" className="w-40" error={end < start ? 'Must be on or after the start' : undefined}>
              <Input type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Button type="submit" disabled={invalid} loading={issue.isPending}>
              Issue certificate
            </Button>
          </form>
        ) : (
          <Banner tone="info">Certificates can be issued once your organisation is verified.</Banner>
        )}
        <QueryState query={certificates} empty={<EmptyState compact title="No certificates yet" description="Issue one for a period that includes verified handovers." />}>
          {(list) => (
            <ul className="divide-y divide-white/5">
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-mono text-sm text-white">{c.certificateNumber}</p>
                    <p className="text-xs text-slate-400">
                      {formatDate(c.periodStart)} – {formatDate(c.periodEnd)} · {formatNumber(c.mealsRedistributed)} meals · {formatNumber(c.ordersCompleted)} handovers · {formatNumber(c.pointsEarned)} pts
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={downloading === c.id}
                    leftIcon={<Download className="size-4" aria-hidden="true" />}
                    onClick={async () => {
                      setDownloading(c.id);
                      try {
                        await downloadCertificate(c);
                      } catch (err) {
                        toast.error(err);
                      } finally {
                        setDownloading(null);
                      }
                    }}
                  >
                    PDF
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
