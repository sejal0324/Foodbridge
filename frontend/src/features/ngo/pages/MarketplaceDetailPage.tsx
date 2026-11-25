import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, MapPin, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { MapView, type MapMarker } from '@/components/map';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Countdown,
  DescriptionList,
  DistanceLabel,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  QuantityBadge,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui';
import { FeeEstimateCard } from '@/features/billing';
import { useDonation } from '@/features/donations/api';
import { RecommendationCard, useRecommendedDonations } from '@/features/matching';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useNow } from '@/hooks/useNow';
import { ApiError } from '@/services/apiError';
import type { DonationDetail, DonationRequestSummary } from '@/types';
import { formatDateTime, formatQuantity, formatRelative, formatWindow, unitLabel } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { DIETARY_LABELS, STORAGE_LABELS } from '@/utils/labels';
import { useCreateDonationRequest, useNgoProfile, useWithdrawRequest } from '../api';
import { FeeBreakdown } from '../components/FeeBreakdown';
import type { DonationRequestCreated, NgoProfile } from '../types';
import { distanceMeters } from '../utils';

const OPEN = ['AVAILABLE', 'PARTIALLY_RESERVED'];
const ACTIVE_REQUEST = ['PENDING', 'APPROVED'];

export default function MarketplaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useDonation(id);
  const profile = useNgoProfile();
  if (query.isPending) return <LoadingState label="Loading donation…" />;
  if (query.isError) return <ErrorState error={query.error} title="This donation could not be loaded" onRetry={() => void query.refetch()} />;
  return <DonationView d={query.data} profile={profile.data} />;
}

function DonationView({ d, profile }: { d: DonationDetail; profile: NgoProfile | undefined }) {
  const recommendations = useRecommendedDonations();
  const [created, setCreated] = useState<DonationRequestCreated | null>(null);
  const rec = recommendations.data?.find((r) => r.donation.id === d.id);
  const now = useNow(60_000);
  const open = OPEN.includes(d.status) && d.availableQuantity > 0 && Date.parse(d.pickupDeadline) > now;
  const activeRequest = d.requests.find((r) => ACTIVE_REQUEST.includes(r.status));
  const pastRequests = d.requests.filter((r) => !ACTIVE_REQUEST.includes(r.status));
  const distanceKm = profile?.location && d.location ? distanceMeters(profile.location, d.location) / 1000 : null;

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    if (d.location) out.push({ id: 'pickup', position: d.location, kind: 'pickup', label: 'P', title: `Pickup: ${d.address}` });
    if (profile?.location) out.push({ id: 'ngo', position: profile.location, kind: 'ngo', label: 'N', title: `${profile.organizationName} (you)` });
    return out;
  }, [d.location, d.address, profile]);

  return (
    <>
      <PageHeader
        title={d.foodName}
        description={`${d.donor.name} · ${d.category.name} · ${DIETARY_LABELS[d.dietaryType]}`}
        back={{ to: '/ngo/marketplace', label: 'Marketplace' }}
        meta={
          <>
            <StatusBadge status={d.status} />
            <QuantityBadge quantity={d.availableQuantity} unit={d.unit} />
            {open ? <Countdown to={d.pickupDeadline} /> : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Food details" as="h3" />
            <CardBody>
              <DescriptionList
                items={[
                  { term: 'Available now', description: formatQuantity(d.availableQuantity, d.unit) },
                  { term: 'Listed quantity', description: formatQuantity(d.quantity, d.unit) },
                  { term: 'Diet', description: DIETARY_LABELS[d.dietaryType] },
                  { term: 'Category', description: d.category.name },
                  { term: 'Prepared', description: formatDateTime(d.preparedAt) },
                  { term: 'Best before', description: d.bestBefore ? formatDateTime(d.bestBefore) : 'Not given' },
                  { term: 'Storage', description: `${STORAGE_LABELS[d.storageType]}${d.storageNotes ? ` · ${d.storageNotes}` : ''}` },
                  { term: 'Pickup window', description: formatWindow(d.pickupAvailableFrom, d.pickupDeadline) },
                  ...(d.description ? [{ term: 'Notes from the donor', description: d.description }] : []),
                ]}
              />
              <p className="mt-4 text-xs text-slate-500">The donor confirmed this food is fit to eat. FoodBridge does not certify food safety; check it at pickup.</p>
            </CardBody>
          </Card>

          {rec ? (
            <section aria-labelledby="why-recommended">
              <h2 id="why-recommended" className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
                <Sparkles className="size-4 text-brand-300" aria-hidden="true" /> Why this was recommended to you
              </h2>
              <RecommendationCard
                title={d.foodName}
                subtitle={`${d.donor.name} · ${formatQuantity(rec.donation.availableQuantity, rec.donation.unit)}`}
                score={rec.score}
                explanation={rec.explanation}
                limitations={rec.limitations}
                criteria={rec.criteria}
                distanceKm={rec.distanceKm}
                distanceSource={rec.distanceSource}
                rankingStatus={rec.rankingStatus}
              />
            </section>
          ) : null}

          {created ? (
            <RequestSentCard created={created} d={d} />
          ) : activeRequest ? (
            <ActiveRequestCard request={activeRequest} unit={d.unit} />
          ) : open ? (
            <RequestForm d={d} profile={profile} onCreated={setCreated} />
          ) : (
            <Banner tone="info">This donation is no longer available to request.</Banner>
          )}

          {pastRequests.length > 0 ? (
            <Card>
              <CardHeader title="Your earlier requests" as="h3" />
              <CardBody>
                <ul className="divide-y divide-white/5 text-sm">
                  {pastRequests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-slate-300">
                        {formatQuantity(r.requestedQuantity, d.unit)} · {formatRelative(r.createdAt)}
                        {r.decisionReason ? ` · ${r.decisionReason}` : ''}
                      </span>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Pickup location" as="h3" icon={<MapPin className="size-4" aria-hidden="true" />} />
            <CardBody className="space-y-3">
              <MapView ariaLabel={`Pickup location of ${d.foodName}${profile?.location ? ' and your NGO' : ''}`} markers={markers} fitToContent height={260} />
              <p className="text-sm text-slate-300">{d.address}</p>
              {distanceKm !== null ? <DistanceLabel km={distanceKm} source="STRAIGHT_LINE_ESTIMATE" /> : null}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function ActiveRequestCard({ request, unit }: { request: DonationRequestSummary; unit: string }) {
  const withdraw = useWithdrawRequest();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const pending = request.status === 'PENDING';
  return (
    <Card>
      <CardHeader title="Your request" as="h3" actions={<StatusBadge status={request.status} />} />
      <CardBody className="space-y-3 text-sm">
        <p className="text-slate-200">
          You requested {formatQuantity(request.requestedQuantity, unit)} {formatRelative(request.createdAt)}.
          {request.approvedQuantity !== null ? ` The donor approved ${formatQuantity(request.approvedQuantity, unit)}.` : ''}
        </p>
        {request.message ? <p className="text-slate-400">Your message: “{request.message}”</p> : null}
        <p className="text-slate-400">
          {pending ? 'The donor decides whether to approve it. You are notified either way.' : 'The food is reserved for you. Assign a representative to collect it from Collections.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Withdraw request
            </Button>
          ) : (
            <ButtonLink to="/ngo/collections" size="sm">
              Go to collections
            </ButtonLink>
          )}
          <ButtonLink to="/ngo/requests" size="sm" variant="ghost">
            All my requests
          </ButtonLink>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Withdraw this request?"
        description="The donor will no longer see it. You can request this donation again while it is available."
        confirmLabel="Withdraw"
        tone="danger"
        loading={withdraw.isPending}
        onConfirm={() =>
          withdraw
            .mutateAsync(request.id)
            .then(() => {
              toast.success('Request withdrawn');
              setConfirming(false);
            })
            .catch((e: unknown) => toast.error(e))
        }
      />
    </Card>
  );
}

function requestSchema(max: number) {
  return z.object({
    quantity: z.number({ error: 'Enter a quantity' }).int('Use a whole number').min(1, 'Enter at least 1').max(max, `Only ${max} available`),
    message: z.string().trim().max(1000, 'Use at most 1000 characters'),
  });
}
type RequestValues = z.infer<ReturnType<typeof requestSchema>>;

/** Business errors that need an explanation and a way forward rather than a field message. */
function RequestErrorBanner({ error }: { error: ApiError }) {
  switch (error.code) {
    case 'DIETARY_INCOMPATIBLE':
      return (
        <Banner tone="danger" title="Your profile does not accept this diet" live>
          {error.message} If you can now take it, change “Accepts vegetarian / non-vegetarian” in <Link to="/ngo/profile" className="font-medium underline">your profile</Link>.
        </Banner>
      );
    case 'CATEGORY_NOT_ACCEPTED':
      return (
        <Banner tone="danger" title="This food category is not in your preferences" live>
          {error.message} Food preferences are a matching filter: add this category under <Link to="/ngo/profile#food-preferences" className="font-medium underline">Profile → Food preferences</Link> and try again.
        </Banner>
      );
    case 'DUPLICATE_REQUEST':
      return (
        <Banner tone="warning" title="You have already requested this donation" live>
          {error.message} See it in <Link to="/ngo/requests" className="font-medium underline">My requests</Link>; withdraw it there first if you want to change the quantity.
        </Banner>
      );
    case 'DONATION_NOT_AVAILABLE':
      return (
        <Banner tone="warning" title="No longer available" live>
          {error.message}
        </Banner>
      );
    default:
      return (
        <Banner tone="danger" live>
          {error.message}
        </Banner>
      );
  }
}

/** Shown after a successful request: the fee estimate returned by POST /donations/:id/requests. */
function RequestSentCard({ created, d }: { created: DonationRequestCreated; d: DonationDetail }) {
  return (
    <Card>
      <CardHeader title="Request sent" as="h3" icon={<CheckCircle2 className="size-4 text-brand-300" aria-hidden="true" />} actions={<StatusBadge status={created.status} />} />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-200">
          You asked for {formatQuantity(created.quantity, d.unit)}. {d.donor.name} decides whether to approve it; you are notified either way. Nothing is charged unless the food is handed over and both sides confirm the quantity.
        </p>
        <FeeBreakdown fee={created.feeEstimate} title="Fee if this collection completes" />
        <div className="flex flex-wrap gap-2">
          <ButtonLink to="/ngo/requests" size="sm">
            View my requests
          </ButtonLink>
          <ButtonLink to="/ngo/marketplace" size="sm" variant="ghost">
            Back to the marketplace
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}

function RequestForm({ d, profile, onCreated }: { d: DonationDetail; profile: NgoProfile | undefined; onCreated: (r: DonationRequestCreated) => void }) {
  const create = useCreateDonationRequest(d.id);
  const toast = useToast();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const schema = useMemo(() => requestSchema(d.availableQuantity), [d.availableQuantity]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RequestValues>({ resolver: zodResolver(schema), defaultValues: { quantity: d.availableQuantity, message: '' } });
  const quantity = useWatch({ control, name: 'quantity' });
  const debounced = useDebouncedValue(quantity, 400);

  const dietMismatch = profile ? (d.dietaryType === 'VEG' && !profile.acceptsVeg) || (d.dietaryType === 'NON_VEG' && !profile.acceptsNonVeg) : false;
  const categoryMismatch = profile ? !profile.foodPreferences.some((c) => c.id === d.category.id) : false;

  const onSubmit = handleSubmit(async (v) => {
    setFailure(null);
    try {
      const result = await create.mutateAsync({ quantity: v.quantity, ...(v.message.trim() ? { message: v.message.trim() } : {}) });
      onCreated(result);
      toast.success('Request sent', `${d.donor.name} has been notified.`);
    } catch (err) {
      const e = ApiError.from(err);
      if (e.code === 'INSUFFICIENT_QUANTITY') {
        const available = (e.details as { available?: number } | undefined)?.available;
        setError('quantity', { type: 'server', message: available !== undefined ? `Only ${available} ${unitLabel(d.unit, available)} are still available.` : e.message }, { shouldFocus: true });
        return;
      }
      const formMessage = applyServerErrors(err, setError, { fields: ['quantity', 'message'] });
      if (formMessage) setFailure(e);
    }
  });

  return (
    <Card>
      <CardHeader title="Request this food" as="h3" description={`Up to ${formatQuantity(d.availableQuantity, d.unit)} available. Request only what you can collect and distribute.`} />
      <CardBody>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {failure ? <RequestErrorBanner error={failure} /> : null}
          {dietMismatch ? (
            <Banner tone="warning">
              Your profile does not accept {DIETARY_LABELS[d.dietaryType].toLowerCase()} food, so the request will be refused. <Link to="/ngo/profile" className="font-medium underline">Update your profile</Link> if that has changed.
            </Banner>
          ) : null}
          {!dietMismatch && categoryMismatch ? (
            <Banner tone="warning">
              “{d.category.name}” is not in your food preferences, so the request will be refused. <Link to="/ngo/profile#food-preferences" className="font-medium underline">Add it to your preferences</Link> first.
            </Banner>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Quantity (${unitLabel(d.unit, 2)})`} error={errors.quantity?.message} hint="Whole numbers only" required>
              <Input type="number" inputMode="numeric" min={1} max={d.availableQuantity} step={1} {...register('quantity', { valueAsNumber: true })} />
            </Field>
            <Field label="Message to the donor" error={errors.message?.message} hint="Optional, e.g. when you can collect" className="sm:col-span-2">
              <Textarea {...register('message')} maxLength={1000} />
            </Field>
          </div>
          <FeeEstimateCard unit={d.unit} quantity={Number.isInteger(debounced) ? debounced : 0} />
          <Button type="submit" loading={isSubmitting} leftIcon={<Send className="size-4" aria-hidden="true" />}>
            Send request
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
