import { Bell, CheckCircle2, HandHeart, IndianRupee, Navigation, Plus, QrCode, Sparkles, Store, Truck, Users, UtensilsCrossed } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, ButtonLink, Card, CardBody, CardHeader, Countdown, DistanceLabel, EmptyState, PageHeader, SkeletonList, StatCard, StatusBadge } from '@/components/ui';
import { useAssistanceRequests } from '@/features/assistance/api';
import { UrgencyBadge } from '@/features/assistance/components/AssistanceRequestCard';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { useRecommendedDonations } from '@/features/matching';
import { NotificationItem, useMarkNotificationRead, useNotifications } from '@/features/notifications';
import { usePickups } from '@/features/pickups/api';
import { formatINR, formatNumber, formatQuantity } from '@/utils/format';
import { DIETARY_LABELS } from '@/utils/labels';
import { isActiveRepresentative, isNgoOwner, ngoNameOf } from '../access';
import { useBillingSummary, useNgoAnalytics } from '../api';
import { AssistanceProgress, SectionLink } from '../components/common';
import type { OwnerOnlyRedirectState } from '../guards';

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function OverviewPage() {
  const user = useCurrentUser();
  const location = useLocation();
  const redirected = (location.state as OwnerOnlyRedirectState | null)?.ownerOnly === true;
  const owner = isNgoOwner(user);
  const firstName = user.fullName.split(' ')[0] ?? user.fullName;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={owner ? `Here is what is happening at ${ngoNameOf(user)} today.` : `You collect food on behalf of ${ngoNameOf(user)}.`}
        actions={
          owner && isOrganisationApproved(user) ? (
            <>
              <ButtonLink to="/ngo/marketplace" variant="outline" leftIcon={<Store className="size-4" aria-hidden="true" />}>
                Browse food
              </ButtonLink>
              <ButtonLink to="/ngo/assistance/new" leftIcon={<Plus className="size-4" aria-hidden="true" />}>
                Ask for food
              </ButtonLink>
            </>
          ) : null
        }
      />
      {redirected ? (
        <Banner tone="info" className="mb-6" live>
          That page is available to the NGO’s organisation account only. As a representative you can open your pickups, notifications, the assistant and your account.
        </Banner>
      ) : null}
      {owner ? <OwnerOverview /> : <RepresentativeOverview />}
    </>
  );
}

function OwnerOverview() {
  const user = useCurrentUser();
  const approved = isOrganisationApproved(user);
  const analytics = useNgoAnalytics();
  const a = analytics.data;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Meals received" value={formatNumber(a?.totals.mealsReceived)} hint="Confirmed by both sides at handover" icon={<UtensilsCrossed className="size-5" aria-hidden="true" />} loading={analytics.isPending} />
        <StatCard label="Active collections" value={formatNumber(a?.totals.activeCollections)} hint="Reserved, assigned or on the way" icon={<Truck className="size-5" aria-hidden="true" />} loading={analytics.isPending} />
        <StatCard
          label="Successful collections"
          value={a?.successfulCollectionRate === null || a?.successfulCollectionRate === undefined ? '—' : `${formatNumber(a.successfulCollectionRate)}%`}
          hint={a ? `${a.totals.completedCollections} completed · ${a.totals.failedCollections} cancelled or expired` : undefined}
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          loading={analytics.isPending}
        />
        <StatCard label="People served" value={formatNumber(a?.totals.beneficiariesServed)} hint="Reported at delivery" icon={<Users className="size-5" aria-hidden="true" />} loading={analytics.isPending} />
      </div>
      {analytics.isError ? <p className="text-sm text-amber-300">Statistics are unavailable right now.</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          {approved ? <RecommendedDonationsCard /> : null}
          <OpenAssistanceCard />
          <ActivePickupsCard title="Active pickups" />
        </div>
        <div className="space-y-6">
          <BillingSnippetCard />
          <RecentNotificationsCard />
        </div>
      </div>
    </div>
  );
}

function RepresentativeOverview() {
  const user = useCurrentUser();
  const active = isActiveRepresentative(user);
  return (
    <div className="space-y-6">
      {!active ? (
        <Banner tone="warning" title="Your representative authorisation is not active">
          {ngoNameOf(user)} has deactivated or not yet activated your account for collections, so pickup passes and location sharing are unavailable. Contact the NGO.
        </Banner>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <ActivePickupsCard title="Your active pickups" />
          <Card>
            <CardHeader title="At the pickup" as="h3" icon={<QrCode className="size-4" aria-hidden="true" />} />
            <CardBody>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
                <li>Open the pickup and generate your QR pass shortly before you arrive (it expires after a short time).</li>
                <li>The donor scans the pass, then you show the photo ID you registered; the donor checks it against the last 4 characters on file.</li>
                <li>Count the food together and confirm the quantity you received in the app.</li>
              </ol>
              <p className="mt-3 flex items-start gap-2 text-xs text-slate-400">
                <Navigation className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Location sharing is optional, needs your consent, and works only while the pickup page is open. Arriving at the location never completes a handover.
              </p>
            </CardBody>
          </Card>
        </div>
        <RecentNotificationsCard />
      </div>
    </div>
  );
}

function RecommendedDonationsCard() {
  const query = useRecommendedDonations();
  return (
    <Card>
      <CardHeader
        title="Recommended for you"
        description="Open donations matched to your needs, capacity and radius"
        icon={<Sparkles className="size-4" aria-hidden="true" />}
        actions={<SectionLink to="/ngo/marketplace">Marketplace</SectionLink>}
      />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No recommendations right now" description="When a donor near you lists food that fits your profile, it appears here." />}>
          {(items) => (
            <ul className="divide-y divide-white/5">
              {items.slice(0, 4).map((r) => (
                <li key={r.donation.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/ngo/marketplace/${r.donation.id}`} className="text-sm font-medium text-white hover:underline">
                        {r.donation.foodName}
                      </Link>
                      <span className="text-xs text-slate-400">· {formatQuantity(r.donation.availableQuantity, r.donation.unit)}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {r.donation.donorName} · {r.donation.categoryName} · {DIETARY_LABELS[r.donation.dietaryType]}
                    </p>
                    {r.explanation ? <p className="mt-1 line-clamp-2 text-xs text-slate-300">{r.explanation}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <DistanceLabel km={r.distanceKm} source={r.distanceSource} className="text-xs" />
                      <Countdown to={r.donation.pickupDeadline} />
                    </div>
                  </div>
                  {r.score !== null ? (
                    <Badge tone="info" title="Match score out of 100">
                      match {Math.round(r.score)}
                    </Badge>
                  ) : (
                    <Badge tone="warning">distance order</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function OpenAssistanceCard() {
  const query = useAssistanceRequests({ page: 1, pageSize: 5, status: 'OPEN,PARTIALLY_FULFILLED' });
  return (
    <Card>
      <CardHeader title="Your open requests" description="Food you asked donors for" icon={<HandHeart className="size-4" aria-hidden="true" />} actions={<SectionLink to="/ngo/assistance">All requests</SectionLink>} />
      <CardBody>
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <EmptyState
              compact
              title="No open requests"
              description="Ask nearby donors for the food you need; matching donors are notified."
              action={
                <ButtonLink to="/ngo/assistance/new" size="sm">
                  Ask for food
                </ButtonLink>
              }
            />
          }
        >
          {(data) => (
            <ul className="divide-y divide-white/5">
              {data.items.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Link to={`/ngo/assistance/${r.id}`} className="text-sm font-medium text-white hover:underline">
                      {formatQuantity(r.quantityRequired, r.unit)} · {r.category.name}
                    </Link>
                    <UrgencyBadge urgency={r.urgency} />
                    <StatusBadge status={r.status} />
                  </div>
                  <AssistanceProgress request={r} compact />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function ActivePickupsCard({ title }: { title: string }) {
  const query = usePickups({ active: true });
  return (
    <Card>
      <CardHeader title={title} icon={<Truck className="size-4" aria-hidden="true" />} actions={<SectionLink to="/ngo/pickups">All pickups</SectionLink>} />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No pickups in progress" description="Assigned collections appear here until the food is delivered." />}>
          {(rows) => (
            <ul className="divide-y divide-white/5">
              {rows.slice(0, 5).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/ngo/pickups/${p.id}`} className="text-sm font-medium text-white hover:underline">
                        {p.donation.foodName}
                      </Link>
                      {p.viewer === 'REPRESENTATIVE' ? <Badge tone="brand">You collect</Badge> : null}
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatQuantity(p.donation.quantity, p.donation.unit)} · {p.donor.name} · {p.representative.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? <Countdown to={p.donation.pickupDeadline} /> : null}
                    <StatusBadge status={p.status} />
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

function BillingSnippetCard() {
  const query = useBillingSummary();
  const s = query.data;
  return (
    <Card>
      <CardHeader title="Service fees" description="₹ per verified meal, packet or box collected" icon={<IndianRupee className="size-4" aria-hidden="true" />} actions={<SectionLink to="/ngo/billing">Billing</SectionLink>} />
      <CardBody>
        {query.isPending ? (
          <SkeletonList rows={2} />
        ) : query.isError ? (
          <p className="text-sm text-amber-300">Billing is unavailable right now.</p>
        ) : s ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-400">Not yet invoiced</dt>
              <dd className="text-lg font-semibold text-white tabular-nums">{formatINR(s.uninvoicedAmount)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Invoiced, unpaid</dt>
              <dd className="text-lg font-semibold text-white tabular-nums">{formatINR(s.outstandingInvoicedAmount)}</dd>
            </div>
            <div className="col-span-2 text-xs text-slate-400">
              {s.feeRules.length > 0 ? `${formatINR(s.feeRules[0]?.amountPerUnit)} per unit` : 'No fee rules'} · {formatNumber(s.billedCollections)} billed collections · {formatINR(s.thisMonthAmount)} this month
            </div>
          </dl>
        ) : null}
      </CardBody>
    </Card>
  );
}

function RecentNotificationsCard() {
  const query = useNotifications({ page: 1, pageSize: 5 });
  const markRead = useMarkNotificationRead();
  return (
    <Card>
      <CardHeader title="Recent notifications" icon={<Bell className="size-4" aria-hidden="true" />} actions={<SectionLink to="/ngo/notifications">All</SectionLink>} />
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
