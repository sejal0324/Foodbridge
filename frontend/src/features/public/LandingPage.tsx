import {
  ArrowRight,
  Award,
  BadgeCheck,
  Bot,
  Brain,
  Building2,
  ClipboardList,
  HandHeart,
  HeartHandshake,
  IndianRupee,
  Leaf,
  MapPinned,
  QrCode,
  Route,
  Scale,
  ShieldCheck,
  Split,
  TrendingUp,
  Truck,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, Skeleton } from '@/components/ui';
import { usePublicImpact } from '@/features/analytics/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDateTime, formatNumber } from '@/utils/format';

function Section({ id, eyebrow, title, intro, children, className }: { id?: string; eyebrow?: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`scroll-mt-20 py-20 sm:py-24 ${className ?? ''}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          {eyebrow ? <p className="text-sm font-semibold tracking-wide text-brand-300 uppercase">{eyebrow}</p> : null}
          <h2 id={id ? `${id}-title` : undefined} className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {title}
          </h2>
          {intro ? <p className="mt-4 text-base leading-relaxed text-slate-400">{intro}</p> : null}
        </div>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function FeatureCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-surface p-6">
      <div className="grid size-10 place-items-center rounded-lg bg-brand-600/15 text-brand-300">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-slate-400">{children}</div>
    </div>
  );
}

function Steps({ steps }: { steps: { icon: LucideIcon; title: string; body: string }[] }) {
  return (
    <ol className="relative flex flex-col gap-5">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.title} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-brand-400/30 bg-brand-600/15 text-brand-200">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              {i < steps.length - 1 ? <span className="mt-1 w-px flex-1 bg-white/10" aria-hidden="true" /> : null}
            </div>
            <div className="pb-2">
              <p className="text-sm font-semibold text-white">
                <span className="mr-2 text-slate-500 tabular-nums">{i + 1}.</span>
                {s.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{s.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ImpactStats() {
  const impact = usePublicImpact();
  const stats = impact.data
    ? [
        { label: 'Meals redistributed', value: impact.data.mealsRedistributed, icon: UtensilsCrossed },
        { label: 'Verified handovers', value: impact.data.verifiedHandovers, icon: ShieldCheck },
        { label: 'People served', value: impact.data.beneficiariesServed, icon: Users },
        { label: 'Verified donors', value: impact.data.verifiedDonors, icon: Building2 },
        { label: 'Verified NGOs', value: impact.data.verifiedNgos, icon: HeartHandshake },
      ]
    : [];
  return (
    <div className="flex flex-col gap-6">
      {impact.isError ? (
        <Banner tone="warning">Live impact statistics are unavailable right now. Please check back shortly.</Banner>
      ) : (
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {impact.isPending
            ? Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-surface p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-3 h-8 w-16" />
                </div>
              ))
            : stats.map((s) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="rounded-2xl border border-white/10 bg-surface p-5">
                    <dt className="flex items-center gap-2 text-sm text-slate-400">
                      <Icon className="size-4 text-slate-500" aria-hidden="true" />
                      {s.label}
                    </dt>
                    <dd className="mt-2 text-3xl font-semibold tracking-tight text-white tabular-nums">{formatNumber(s.value)}</dd>
                  </div>
                );
              })}
        </dl>
      )}
      {impact.data ? (
        <p className="text-xs text-slate-500">
          Counted only from two-way verified handovers. Updated {formatDateTime(impact.data.generatedAt)}.
          {impact.data.dataLabel !== 'REAL' ? (
            <Badge tone="violet" className="ml-2">
              Includes demo data
            </Badge>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export default function LandingPage() {
  useDocumentTitle('Turn surplus food into someone’s next meal');
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_0%,rgba(46,125,50,0.18),transparent)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <Badge tone="brand" icon={<Leaf className="size-3" aria-hidden="true" />}>
              Predict. Match. Redistribute.
            </Badge>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">Turn Surplus Food Into Someone&apos;s Next Meal.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
              FoodBridge AI connects restaurants, hotels and caterers across India with verified NGOs. Donors list surplus food for free, NGOs post what they actually need, and every
              collection is verified from pickup to delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/register?type=DONOR" size="lg" rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}>
                Donate surplus food
              </ButtonLink>
              <ButtonLink to="/register?type=NGO" size="lg" variant="outline">
                Register your NGO
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-slate-500">Free for donors, available across India. Every organisation is verified before it can list or collect food.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-surface/80 p-6 shadow-2xl shadow-black/40">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">One collection, end to end</p>
            <ul className="mt-5 flex flex-col gap-4">
              {[
                { icon: TrendingUp, title: 'Predict', body: 'Estimate likely surplus from your own daily records.' },
                { icon: Scale, title: 'Match', body: 'Rank nearby NGOs with an explainable, weighted score.' },
                { icon: QrCode, title: 'Verify', body: 'QR pass, one-time code and an ID check at handover.' },
                { icon: Truck, title: 'Redistribute', body: 'Live tracking until the NGO confirms delivery.' },
              ].map((s) => (
                <li key={s.title} className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600/15 text-brand-300">
                    <s.icon className="size-4.5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{s.title}</span>
                    <span className="block text-sm text-slate-400">{s.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Product intro + problem */}
      <Section
        eyebrow="The problem"
        title="Good food is thrown away while shelters run short"
        intro="Food businesses across India often end the day with safe, cooked food they cannot sell. Nearby NGOs need exactly that food, but coordination fails: nobody knows what is available, when it can be collected, or whether the person at the door is really from the NGO."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <FeatureCard icon={ClipboardList} title="No shared picture">
            Surplus appears late in the day and disappears into the bin before anyone hears about it. FoodBridge publishes it to matched NGOs within minutes.
          </FeatureCard>
          <FeatureCard icon={ShieldCheck} title="Trust at the handover">
            Donors need to know who is collecting. Each pickup requires a single-use QR pass and a photo-ID check of the representative.
          </FeatureCard>
          <FeatureCard icon={MapPinned} title="Logistics and timing">
            Cooked food has a short window. Pickup deadlines, partial quantities and live tracking keep collections realistic and on time.
          </FeatureCard>
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" eyebrow="How it works" title="Two ways food finds the right place" className="border-t border-white/10 bg-surface/30">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-surface p-6 sm:p-8">
            <div className="flex items-center gap-2">
              <Badge tone="brand">Workflow A</Badge>
              <h3 className="text-lg font-semibold text-white">A donor lists surplus food</h3>
            </div>
            <div className="mt-6">
              <Steps
                steps={[
                  { icon: UtensilsCrossed, title: 'List the food', body: 'Name, category, quantity in meals, packets or boxes, storage and a pickup deadline. The donor confirms the food is fit to donate.' },
                  { icon: Scale, title: 'Matched NGOs are notified', body: 'Eligible NGOs are ranked by distance, capacity, needs and reliability, with the reasons shown.' },
                  { icon: Split, title: 'Approve requests, even partially', body: 'Split one donation across several NGOs. Quantities are reserved atomically, so nothing is promised twice.' },
                  { icon: QrCode, title: 'Verified pickup', body: 'The representative shows a QR pass; the donor checks the photo ID before handing over.' },
                  { icon: BadgeCheck, title: 'Two-way confirmation', body: 'Both sides confirm the quantity. Matching numbers complete the handover; a mismatch is reviewed by FoodBridge.' },
                ]}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-surface p-6 sm:p-8">
            <div className="flex items-center gap-2">
              <Badge tone="info">Workflow B</Badge>
              <h3 className="text-lg font-semibold text-white">An NGO posts what it needs</h3>
            </div>
            <div className="mt-6">
              <Steps
                steps={[
                  { icon: HandHeart, title: 'Post a requirement', body: 'Quantity, dietary needs, urgency, people served and the time window it is needed in.' },
                  { icon: Brain, title: 'Likely donors are found', body: 'Donors who are open, nearby and usually have matching surplus are invited to help.' },
                  { icon: Split, title: 'Donors offer full or partial quantities', body: 'Several donors can each cover part of the need; the NGO accepts the offers that fit.' },
                  { icon: ShieldCheck, title: 'Donor confirms the food is ready', body: 'The actual quantity is confirmed and reserved before anyone travels.' },
                  { icon: Truck, title: 'Collection and delivery', body: 'The same verified pickup, live tracking and delivery confirmation as Workflow A.' },
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* AI */}
      <Section
        id="ai"
        eyebrow="AI capabilities"
        title="AI that explains itself, and knows its limits"
        intro="AI on FoodBridge recommends; people decide. Every score shows its reasons, every estimate is labelled as an estimate, and core features keep working when the AI service is offline."
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={TrendingUp} title="Surplus forecasting">
            Estimates a donor’s likely surplus per meal period from their own daily records, with an approximate range. The current model is trained on synthetic data and says
            so. A forecast is never a donation.
          </FeatureCard>
          <FeatureCard icon={Scale} title="Explainable matching">
            A weighted score across distance, quantity, capacity, dietary fit, urgency, timing and reliability, with a per-criterion breakdown and plain-language reasons.
            Distances are labelled as straight-line estimates unless road data is available.
          </FeatureCard>
          <FeatureCard icon={Route} title="Optimisation">
            Suggests how to split a donation across several NGO requests, and plans multi-stop collection routes for NGOs. Suggestions are reviewed and confirmed by a person.
          </FeatureCard>
          <FeatureCard icon={Bot} title="Assistant">
            Ask about your donations, requests, forecasts or rewards. It answers only from your own data through permission-checked tools and cannot change anything without
            your confirmation.
          </FeatureCard>
        </div>
      </Section>

      {/* Benefits */}
      <Section id="donors" eyebrow="For donors" title="Free for donors, with recognition that adds up" className="border-t border-white/10 bg-surface/30">
        <div className="grid gap-5 md:grid-cols-3">
          <FeatureCard icon={IndianRupee} title="Always free">
            Listing food, matching and verified collection cost donors nothing. Donors are never charged.
          </FeatureCard>
          <FeatureCard icon={Award} title="Reward points">
            10 points for every verified meal, 15 points per meal after 500 lifetime meals, and 10 points per verified packet or box order. Points come only from two-way
            verified handovers.
          </FeatureCard>
          <FeatureCard icon={BadgeCheck} title="Impact certificates">
            Download certificates for any period, backed by the verified ledger. Appear by name on the monthly leaderboard only if you opt in.
          </FeatureCard>
        </div>
      </Section>

      <Section id="ngos" eyebrow="For NGOs" title="Food you can plan around, with a fee you can predict">
        <div className="grid gap-5 md:grid-cols-3">
          <FeatureCard icon={IndianRupee} title="₹5 per redistributed unit">
            A transparent service fee of ₹5 per meal, packet or box, charged only for food collected through a two-way verified handover. Nothing is charged for cancelled,
            rejected, expired or unsuccessful collections.
          </FeatureCard>
          <FeatureCard icon={HandHeart} title="Ask for what you need">
            Post requirements by quantity, diet and urgency, accept partial offers from several donors, and see exactly what is still open.
          </FeatureCard>
          <FeatureCard icon={Truck} title="Verified, tracked collections">
            Representatives carry a single-use QR pass, live tracking shows progress (never stale data as live), and delivery confirmation closes the loop.
          </FeatureCard>
        </div>
      </Section>

      {/* Impact */}
      <Section id="impact" eyebrow="Impact" title="Measured from verified handovers only" className="border-t border-white/10 bg-surface/30">
        <ImpactStats />
      </Section>

      {/* Rewards intro + CTA */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-brand-400/20 bg-brand-900/40 px-6 py-14 text-center sm:px-12">
            <Award className="mx-auto size-10 text-brand-300" aria-hidden="true" />
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">Ready to redistribute your surplus?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-slate-300">
              Register in minutes, wherever you are in India. Once FoodBridge verifies your organisation, you can list food or post requirements, and every verified meal earns recognition.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink to="/register?type=DONOR" size="lg">
                I have surplus food
              </ButtonLink>
              <ButtonLink to="/register?type=NGO" size="lg" variant="outline">
                We collect food for people in need
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
