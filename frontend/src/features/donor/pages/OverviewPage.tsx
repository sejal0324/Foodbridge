import { ArrowRight, Award, Bell, CheckCircle2, HandHeart, Plus, QrCode, Truck, Users, UtensilsCrossed } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, ButtonLink, Card, CardBody, CardHeader, Countdown, DistanceLabel, EmptyState, PageHeader, ProgressBar, SkeletonList, StatCard, StatusBadge } from '@/components/ui';
import { useDonorAnalytics } from '@/features/analytics/api';
import { UrgencyBadge } from '@/features/assistance/components/AssistanceRequestCard';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { useDonationRequests } from '@/features/donations/api';
import { useRecommendedAssistanceRequests } from '@/features/matching';
import { NotificationItem, useMarkNotificationRead, useNotifications } from '@/features/notifications';
import { usePickups } from '@/features/pickups/api';
import { useRewardBalance } from '@/features/rewards/api';
import { formatNumber, formatPercent, formatQuantity, formatRelative, formatWindow } from '@/utils/format';
import { useSurplusForecast } from '../api';
import { ForecastCard } from '../components/ForecastCard';

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:underline">
      {children} <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

export default function OverviewPage() {
  const user = useCurrentUser();
  const approved = isOrganisationApproved(user);
  const analytics = useDonorAnalytics();
  const forecast = useSurplusForecast(approved);
  const a = analytics.data;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.fullName.split(' ')[0] ?? user.fullName}`}
        description={user.organization ? `Here is what is happening at ${user.organization.name} today.` : undefined}
        actions={
          approved ? (
            <>
              <ButtonLink to="/donor/pickups/verify" variant="outline" leftIcon={<QrCode className="size-4" aria-hidden="true" />}>
                Verify pickup
              </ButtonLink>
              <ButtonLink to="/donor/donations/new" leftIcon={<Plus className="size-4" aria-hidden="true" />}>
                New donation
              </ButtonLink>
            </>
          ) : null
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Meals redistributed" value={formatNumber(a?.totals.mealsRedistributed)} hint="Two-way verified handovers" icon={<UtensilsCrossed className="size-5" aria-hidden="true" />} loading={analytics.isPending} />
          <StatCard label="Open donations" value={formatNumber(a?.totals.openDonations)} hint={a ? `${formatNumber(a.totals.donations)} listed in total` : undefined} loading={analytics.isPending} />
          <StatCard
            label="Completion rate"
            value={a?.completionRate === null || a?.completionRate === undefined ? '—' : formatPercent(a.completionRate)}
            hint={a ? `${a.totals.completedCollections} completed · ${a.totals.failedCollections} failed` : undefined}
            icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
            loading={analytics.isPending}
          />
          <RewardStat />
        </div>
        {analytics.isError ? <p className="text-sm text-amber-300">Statistics are unavailable right now.</p> : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            <PendingRequestsCard />
            <ActivePickupsCard />
            {approved ? <RecommendedRequestsCard /> : null}
          </div>
          <div className="space-y-6">
            {approved ? <ForecastCard query={forecast} action={<SectionLink to="/donor/forecast">Records and accuracy</SectionLink>} /> : null}
            <RecentNotificationsCard />
          </div>
        </div>
      </div>
    </>
  );
}

function RewardStat() {
  const balance = useRewardBalance();
  const b = balance.data;
  return (
    <div className="rounded-2xl border border-white/10 bg-surface p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-400">Reward points</p>
        <Award className="size-5 text-slate-500" aria-hidden="true" />
      </div>
      {b ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{formatNumber(b.balance)}</p>
          {b.nextRateUpgrade ? (
            <>
              <ProgressBar className="mt-2" value={b.lifetimeMeals} max={b.lifetimeMeals + b.nextRateUpgrade.mealsNeeded} label="Progress to the higher meal rate" />
              <p className="mt-1 text-xs text-slate-400">
                {formatNumber(b.nextRateUpgrade.mealsNeeded)} meals until {b.nextRateUpgrade.pointsPerMeal} points/meal
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-400">{b.tier?.name ? `${b.tier.name.charAt(0)}${b.tier.name.slice(1).toLowerCase()} tier` : ''}</p>
          )}
        </>
      ) : balance.isError ? (
        <p className="mt-2 text-sm text-slate-400">Unavailable</p>
      ) : (
        <SkeletonList rows={1} />
      )}
    </div>
  );
}

function PendingRequestsCard() {
  const query = useDonationRequests({ status: 'PENDING', pageSize: 5 });
  return (
    <Card>
      <CardHeader title="Requests waiting for you" description="NGOs asking for your listed food" icon={<Users className="size-4" aria-hidden="true" />} actions={<SectionLink to="/donor/donations?status=open">Donations</SectionLink>} />
      <CardBody>
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title="No pending requests" description="When an NGO requests your food, approve or reject it here." />}>
          {(data) => (
            <ul className="divide-y divide-white/5">
              {data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                      {r.ngo.name} <span className="font-normal text-slate-400">wants</span> {formatQuantity(r.requestedQuantity, r.donation.unit)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {r.donation.foodName} · {formatNumber(r.ngo.beneficiariesCount)} people served · {formatRelative(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Countdown to={r.donation.pickupDeadline} />
                    <ButtonLink to={`/donor/donations/${r.donation.id}`} size="sm">
                      Review
                    </ButtonLink>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function ActivePickupsCard() {
  const query = usePickups({ active: true });
  return (
    <Card>
      <CardHeader title="Active pickups" icon={<Truck className="size-4" aria-hidden="true" />} actions={<SectionLink to="/donor/pickups">All pickups</SectionLink>} />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No pickups in progress" description="Assigned NGO representatives appear here before they arrive." />}>
          {(rows) => (
            <ul className="divide-y divide-white/5">
              {rows.slice(0, 5).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link to={`/donor/pickups/${p.id}`} className="text-sm font-medium text-white hover:underline">
                      {p.donation.foodName}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {formatQuantity(p.donation.quantity, p.donation.unit)} · {p.ngo.name} · {p.representative.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    {['ASSIGNED', 'EN_ROUTE', 'VERIFIED'].includes(p.status) ? (
                      <ButtonLink to={`/donor/pickups/${p.id}`} size="sm" variant="outline">
                        {p.status === 'VERIFIED' ? 'Confirm handover' : 'Verify'}
                      </ButtonLink>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function RecommendedRequestsCard() {
  const query = useRecommendedAssistanceRequests();
  return (
    <Card>
      <CardHeader title="NGOs you could help" description="Open requests matched to your usual food and hours" icon={<HandHeart className="size-4" aria-hidden="true" />} actions={<SectionLink to="/donor/assistance">All requests</SectionLink>} />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No recommended requests right now" />}>
          {(items) => (
            <ul className="divide-y divide-white/5">
              {items.slice(0, 3).map((r) => (
                <li key={r.request.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/donor/assistance/${r.request.id}`} className="text-sm font-medium text-white hover:underline">
                        {r.request.ngoName} needs {formatQuantity(r.request.quantityRemaining, r.request.unit)}
                      </Link>
                      <UrgencyBadge urgency={r.request.urgency} />
                    </div>
                    <p className="text-xs text-slate-400">
                      {r.request.categoryName} · {formatWindow(r.request.neededFrom, r.request.neededUntil)}
                    </p>
                    <DistanceLabel km={r.distanceKm} source={r.distanceSource} className="text-xs" />
                  </div>
                  {r.score !== null ? <Badge tone="info">match {Math.round(r.score)}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function RecentNotificationsCard() {
  const query = useNotifications({ page: 1, pageSize: 5 });
  const markRead = useMarkNotificationRead();
  return (
    <Card>
      <CardHeader title="Recent notifications" icon={<Bell className="size-4" aria-hidden="true" />} actions={<SectionLink to="/donor/notifications">All</SectionLink>} />
      <div className="pb-2">
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title="No notifications yet" />} compact>
          {(data) => (
            <ul className="divide-y divide-white/5">
              {data.items.map((n) => (
                <li key={n.id}>
                  <NotificationItem n={n} compact onRead={(id) => markRead.mutate(id)} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </Card>
  );
}
