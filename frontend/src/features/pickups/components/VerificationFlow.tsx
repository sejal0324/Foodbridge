import { Award, CheckCircle2, Clock, Hourglass, MessageSquareWarning, OctagonX, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { QrScanner } from '@/components/qr';
import { Banner, Button, ButtonLink, Card, CardBody, CardHeader, Checkbox, Field, Input, QuantityBadge, Textarea } from '@/components/ui';
import { useRewardHistory } from '@/features/rewards/api';
import { ApiError } from '@/services/apiError';
import type { PickupDetail } from '@/types';
import { formatDateTime, formatQuantity, unitLabel } from '@/utils/format';
import { usePickup, usePickupVerification } from '../api';
import { deriveVerificationStep, qrRejectionCopy } from '../verification';
import { RepresentativeCard } from './RepresentativeCard';
import { VerificationStepper } from './VerificationStepper';

export interface VerificationFlowProps {
  /** Resume an existing pickup; omit to start by scanning a pass. */
  pickupId?: string;
  /** Called when a scanned pass belongs to a pickup (e.g. to update the URL). */
  onPickupIdentified?: (pickupId: string) => void;
}

/**
 * Donor handover verification: scan QR (or type the code) → check the
 * representative's photo ID → confirm the quantity → outcome (waiting for the
 * NGO, confirmed with points, or disputed).
 */
export function VerificationFlow({ pickupId: initialId, onPickupIdentified }: VerificationFlowProps) {
  const [pickupId, setPickupId] = useState<string | undefined>(initialId);
  const pickupQuery = usePickup(pickupId);
  const pickup = pickupQuery.data;
  const state = deriveVerificationStep(pickupId ? pickup : null);
  const waiting = state.step === 'OUTCOME' && state.outcome === 'WAITING';
  // While waiting for the NGO's confirmation, poll (realtime notifications also refresh it).
  usePickup(waiting ? pickupId : undefined, { refetchInterval: waiting ? 10_000 : false });

  if (pickupId && pickupQuery.isPending) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-400">Loading pickup…</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Verify the collection" description="Hand over food only after every check passes." icon={<ShieldCheck className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-6">
        {state.step !== 'CLOSED' ? <VerificationStepper current={state.step} /> : null}
        {state.step === 'SCAN' ? (
          <ScanStep
            expectedPickupId={pickupId}
            onVerified={(p) => {
              setPickupId(p.id);
              if (p.id !== initialId) onPickupIdentified?.(p.id);
            }}
          />
        ) : null}
        {pickup && state.step === 'IDENTITY' ? <IdentityStep pickup={pickup} /> : null}
        {pickup && state.step === 'HANDOVER' ? <HandoverStep pickup={pickup} /> : null}
        {pickup && state.step === 'OUTCOME' && state.outcome ? <OutcomeStep pickup={pickup} outcome={state.outcome} /> : null}
        {pickup && state.step === 'CLOSED' ? (
          <Banner tone="info" title={`This pickup is ${pickup.status.toLowerCase()}`}>
            {pickup.cancelReason ? `Reason: ${pickup.cancelReason}. ` : ''}No verification is needed. The reservation can be reassigned by the NGO before the deadline.
          </Banner>
        ) : null}
      </CardBody>
    </Card>
  );
}

// --- Step 1: scan --------------------------------------------------------------
function ScanStep({ expectedPickupId, onVerified }: { expectedPickupId?: string; onVerified: (p: PickupDetail) => void }) {
  const { verifyQr } = usePickupVerification();
  const [rejection, setRejection] = useState<ApiError | null>(null);
  const copy = rejection ? qrRejectionCopy(rejection.detail<string>('reason'), rejection.message) : null;
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-300">
        Ask the representative to open their FoodBridge pickup pass. Scan the QR code, or type the code shown under it.
        {expectedPickupId ? ' A valid pass for another of your pickups will open that pickup instead.' : null}
      </p>
      {copy && rejection ? (
        <Banner tone="danger" live title={copy.title} icon={copy.stop ? <OctagonX className="size-5 text-red-300" aria-hidden="true" /> : undefined}>
          <p>{copy.body}</p>
          {copy.stop ? <p className="mt-1 font-semibold">Do not hand over food.</p> : null}
          {rejection.code !== 'QR_REJECTED' ? <p className="mt-1">{rejection.message}</p> : null}
        </Banner>
      ) : null}
      <QrScanner
        busy={verifyQr.isPending}
        onResult={(token) => {
          setRejection(null);
          verifyQr.mutate(token, {
            onSuccess: (r) => onVerified(r.pickup),
            onError: (e) => setRejection(ApiError.from(e)),
          });
        }}
      />
    </div>
  );
}

// --- Step 2: physical ID ---------------------------------------------------------
function IdentityStep({ pickup }: { pickup: PickupDetail }) {
  const { confirmIdentity } = usePickupVerification();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <Banner tone="success" title="QR pass verified">
        Now compare the person in front of you with the details below.
      </Banner>
      <RepresentativeCard rep={pickup.representative} ngoName={pickup.ngo.name} />
      <Checkbox
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        label="I checked the representative’s physical ID"
        description={`The name, photo and the last 4 characters of their ${pickup.representative.idDocumentType.replace(/_/g, ' ').toLowerCase()} match what is shown above.`}
      />
      {error ? (
        <Banner tone="danger" live>
          {error}
        </Banner>
      ) : null}
      <Button
        disabled={!checked}
        loading={confirmIdentity.isPending}
        onClick={() => {
          setError(null);
          confirmIdentity.mutate(pickup.id, { onError: (e) => setError(ApiError.from(e).message) });
        }}
      >
        Confirm identity
      </Button>
      <p className="text-xs text-slate-500">If anything does not match, do not hand over food. Use “Report a problem” on the pickup page.</p>
    </div>
  );
}

// --- Step 3: quantity ---------------------------------------------------------------
function HandoverStep({ pickup }: { pickup: PickupDetail }) {
  const { confirmHandover } = usePickupVerification();
  const max = pickup.donation.quantity;
  const [quantity, setQuantity] = useState(String(max));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = Number(quantity);
  const valid = Number.isInteger(q) && q >= 1 && q <= max;
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setError(null);
        confirmHandover.mutate({ pickupId: pickup.id, quantity: q, notes: notes.trim() || undefined }, { onError: (err) => setError(ApiError.from(err).message) });
      }}
    >
      <Banner tone="success" title="Representative verified">
        Hand over the food, then confirm the quantity you actually handed over. The NGO confirms what it received separately; points and fees are recorded only when both
        numbers match.
      </Banner>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
        Reserved for this pickup: <QuantityBadge quantity={max} unit={pickup.donation.unit} /> of {pickup.donation.foodName}
      </div>
      {pickup.handover?.ngoReceivedQuantity !== null && pickup.handover?.ngoReceivedQuantity !== undefined ? (
        <p className="text-sm text-slate-400">The NGO has already confirmed its side. Enter your own count independently.</p>
      ) : null}
      <Field label={`Quantity handed over (${unitLabel(pickup.donation.unit, 2)})`} error={!valid && quantity !== '' ? `Enter a whole number from 1 to ${max}` : undefined} required>
        <Input type="number" inputMode="numeric" min={1} max={max} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="max-w-40" />
      </Field>
      <Field label="Notes (optional)" hint="Anything the NGO or FoodBridge should know about this handover.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </Field>
      {error ? (
        <Banner tone="danger" live>
          {error}
        </Banner>
      ) : null}
      <Button type="submit" disabled={!valid} loading={confirmHandover.isPending}>
        Confirm handover
      </Button>
    </form>
  );
}

// --- Step 4: outcome ---------------------------------------------------------------
function OutcomeStep({ pickup, outcome }: { pickup: PickupDetail; outcome: 'WAITING' | 'CONFIRMED' | 'DISPUTED' }) {
  if (outcome === 'WAITING') {
    return (
      <Banner tone="info" title="Waiting for the NGO to confirm" icon={<Hourglass className="size-5 text-sky-300" aria-hidden="true" />}>
        You confirmed {formatQuantity(pickup.handover?.donorConfirmedQuantity ?? 0, pickup.donation.unit)}. The handover completes when the representative confirms the same
        quantity. This page updates automatically.
      </Banner>
    );
  }
  if (outcome === 'DISPUTED') {
    return (
      <Banner tone="danger" title="Quantities do not match: FoodBridge will review" icon={<MessageSquareWarning className="size-5 text-red-300" aria-hidden="true" />}>
        You confirmed {formatQuantity(pickup.handover?.donorConfirmedQuantity ?? 0, pickup.donation.unit)}, but the NGO confirmed a different quantity. FoodBridge will review
        the handover and contact both sides. No reward points or service fees are recorded until it is resolved.
      </Banner>
    );
  }
  return <ConfirmedOutcome pickup={pickup} />;
}

function ConfirmedOutcome({ pickup }: { pickup: PickupDetail }) {
  const history = useRewardHistory(1);
  const handedAt = pickup.handedOverAt ? Date.parse(pickup.handedOverAt) : Number.NaN;
  const credit = history.data?.items.find((t) => t.type === 'CREDIT' && t.referenceType === 'HANDOVER' && Math.abs(Date.parse(t.createdAt) - handedAt) < 10_000);
  return (
    <div className="space-y-4">
      <Banner tone="success" title="Handover confirmed by both sides" icon={<CheckCircle2 className="size-5 text-emerald-300" aria-hidden="true" />}>
        {formatQuantity(pickup.handover?.donorConfirmedQuantity ?? pickup.donation.quantity, pickup.donation.unit)} of {pickup.donation.foodName} handed over to {pickup.ngo.name}
        {pickup.handedOverAt ? ` at ${formatDateTime(pickup.handedOverAt)}` : ''}.
      </Banner>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-400/20 bg-brand-600/10 p-4">
        <div className="flex items-center gap-3">
          <Award className="size-6 text-brand-300" aria-hidden="true" />
          <p className="text-sm text-slate-200">
            {credit ? (
              <>
                You earned <strong className="text-lg text-white">{credit.points}</strong> reward points for this handover.
              </>
            ) : (
              <>Reward points for this verified handover are credited to your balance.</>
            )}
          </p>
        </div>
        <ButtonLink to="/donor/rewards" size="sm" variant="secondary">
          View rewards
        </ButtonLink>
      </div>
      {pickup.deliveredAt ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <CheckCircle2 className="size-4 text-emerald-300" aria-hidden="true" /> Delivered by the NGO at {formatDateTime(pickup.deliveredAt)}.
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Clock className="size-4" aria-hidden="true" /> The NGO confirms delivery when the food reaches its destination.{' '}
          <Link to={`/donor/donations/${pickup.donation.id}`} className="text-brand-300 hover:underline">
            View donation
          </Link>
        </p>
      )}
    </div>
  );
}
