import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, ConfirmDialog, Dialog, Field, Input, Textarea, useToast } from '@/components/ui';
import { FeeEstimateCard } from '@/features/billing';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError } from '@/services/apiError';
import type { Offer, Unit } from '@/types';
import { formatQuantity, unitLabel } from '@/utils/format';
import { useAcceptOffer, useRejectOffer } from '../api';
import type { AcceptedOffer } from '../types';
import { FeeBreakdown } from './FeeBreakdown';

/**
 * Accept a donor's offer, optionally for part of it. The service-fee estimate
 * for the chosen quantity is shown before anything is confirmed.
 */
export function AcceptOfferDialog({ offer, unit, remaining, onClose }: { offer: Offer; unit: Unit; remaining: number; onClose: () => void }) {
  const max = Math.max(0, Math.min(offer.offeredQuantity, remaining));
  const [raw, setRaw] = useState(String(max));
  const [accepted, setAccepted] = useState<AcceptedOffer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const accept = useAcceptOffer();
  const toast = useToast();
  const quantity = Number(raw);
  const valid = raw.trim() !== '' && Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
  const fieldError = raw.trim() === '' ? 'Enter a quantity' : !Number.isInteger(quantity) ? 'Use a whole number' : quantity < 1 ? 'Enter at least 1' : quantity > max ? `At most ${max}` : undefined;
  const estimateQuantity = useDebouncedValue(valid ? quantity : 0, 300);

  const confirm = () => {
    if (!valid) return;
    setFailure(null);
    accept.mutate(
      { offerId: offer.id, quantity },
      {
        onSuccess: (result) => {
          setAccepted(result);
          toast.success('Offer accepted', `${formatQuantity(result.acceptedQuantity ?? quantity, unit)} of ${offer.foodName} from ${offer.donor.name}.`);
        },
        onError: (e) => setFailure(ApiError.from(e).message),
      },
    );
  };

  if (accepted) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Offer accepted"
        footer={
          <Button onClick={onClose} data-autofocus>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-slate-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden="true" />
            <span>
              You accepted {formatQuantity(accepted.acceptedQuantity ?? quantity, unit)} from {offer.donor.name}.{' '}
              {accepted.status === 'RESERVED' || accepted.allocationId
                ? 'The food is ready and reserved: assign a representative from Collections.'
                : 'The donor confirms the actual food when it is ready; it is then reserved for you.'}
            </span>
          </p>
          <FeeBreakdown fee={accepted.feeEstimate} title="Fee if this collection completes" />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Accept ${offer.donor.name}’s offer`}
      description={`${offer.foodName} · offered ${formatQuantity(offer.offeredQuantity, unit)} · you still need ${formatQuantity(remaining, unit)}`}
      dismissible={!accept.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={accept.isPending}>
            Cancel
          </Button>
          <Button onClick={confirm} loading={accept.isPending} disabled={!valid}>
            {valid ? `Accept ${formatQuantity(quantity, unit)}` : 'Accept'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {failure ? (
          <Banner tone="danger" live>
            {failure}
          </Banner>
        ) : null}
        <Field label={`Quantity to accept (${unitLabel(unit, 2)})`} error={fieldError} hint={`Accept all of it or part of it (1–${max}). Anything you do not accept stays with the donor.`} required>
          <Input type="number" inputMode="numeric" min={1} max={max} step={1} value={raw} onChange={(e) => setRaw(e.target.value)} data-autofocus />
        </Field>
        {estimateQuantity > 0 ? <FeeEstimateCard unit={unit} quantity={estimateQuantity} /> : null}
        <p className="text-xs text-slate-400">
          {offer.readyNow ? 'This food is ready now, so accepting reserves it immediately.' : 'This food will be prepared later: the donor confirms the actual quantity when it is ready.'} The fee is charged only for the quantity both sides confirm at handover.
        </p>
      </div>
    </Dialog>
  );
}

export function RejectOfferDialog({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reject = useRejectOffer();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone="danger"
      title={`Decline ${offer.donor.name}’s offer?`}
      description="The donor is notified. Other offers are not affected."
      confirmLabel="Decline offer"
      loading={reject.isPending}
      onConfirm={() =>
        reject
          .mutateAsync({ offerId: offer.id, ...(reason.trim() ? { reason: reason.trim() } : {}) })
          .then(() => {
            toast.success('Offer declined');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason (optional)" hint="Shared with the donor, e.g. “already covered”.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
