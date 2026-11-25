import { CheckCircle2, Circle, Clock, Handshake, PackageCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, Field, Input, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import type { HandoverResult, PickupDetail } from '@/types';
import { formatDateTime, formatNumber, formatQuantity, formatTime, unitLabel } from '@/utils/format';
import { useConfirmDelivery, useNgoConfirmHandover } from '../api';
import { useReportPickupFailure } from '@/features/pickups/api';

/** QR pass → photo ID checks done by the donor before any handover. */
export function VerificationChecks({ checks }: { checks: PickupDetail['checks'] }) {
  const rows = [
    { label: 'QR pass scanned', at: checks.qrVerifiedAt },
    { label: 'Photo ID confirmed', at: checks.identityConfirmedAt },
  ];
  return (
    <ul className="space-y-1.5 text-sm" aria-label="Verification checks">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          {r.at ? <CheckCircle2 className="size-4 text-brand-300" aria-hidden="true" /> : <Circle className="size-4 text-slate-600" aria-hidden="true" />}
          <span className={r.at ? 'text-slate-200' : 'text-slate-500'}>{r.label}</span>
          <span className="text-xs text-slate-500">{r.at ? formatTime(r.at) : 'not yet'}</span>
          <span className="sr-only">{r.at ? 'done' : 'pending'}</span>
        </li>
      ))}
    </ul>
  );
}

function outcomeOf(p: PickupDetail): HandoverResult['outcome'] | null {
  if (p.status === 'DISPUTED' || p.handover?.status === 'DISPUTED') return 'DISPUTED';
  if (p.handover?.status === 'CONFIRMED' || ['HANDED_OVER', 'IN_TRANSIT', 'DELIVERED'].includes(p.status)) return 'CONFIRMED';
  if (p.handover?.ngoReceivedQuantity !== null && p.handover?.ngoReceivedQuantity !== undefined) return 'WAITING';
  return null;
}

/**
 * NGO side of the two-way handover: after the donor's verification
 * (status VERIFIED) the representative or owner confirms the quantity
 * received. Equal quantities → CONFIRMED (the service fee is recorded),
 * different → DISPUTED (reviewed by FoodBridge; no fee).
 */
export function NgoHandoverCard({ pickup: p, showBillingLink }: { pickup: PickupDetail; showBillingLink: boolean }) {
  const confirm = useNgoConfirmHandover();
  const toast = useToast();
  const [raw, setRaw] = useState(String(p.donation.quantity));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const outcome = outcomeOf(p);
  const quantity = Number(raw);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= p.donation.quantity;
  const confirmedQty = p.handover?.ngoReceivedQuantity ?? p.handover?.donorConfirmedQuantity ?? null;

  const submit = () => {
    if (!valid) return;
    setError(null);
    confirm.mutate(
      { pickupId: p.id, quantity, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      {
        onSuccess: (r) => {
          if (r.outcome === 'CONFIRMED') toast.success('Handover confirmed', 'Both sides agree on the quantity.');
          else if (r.outcome === 'DISPUTED') toast.show({ title: 'Quantities differ', description: 'FoodBridge will review the handover.', tone: 'warning' });
          else toast.success('Your confirmation is saved', 'Waiting for the donor to confirm.');
        },
        onError: (e) => setError(ApiError.from(e).message),
      },
    );
  };

  return (
    <Card>
      <CardHeader title="Handover" description="Both you and the donor confirm the quantity handed over." icon={<Handshake className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        {outcome === 'CONFIRMED' ? (
          <Banner tone="success" title="Handover confirmed by both sides" icon={<CheckCircle2 className="size-5" aria-hidden="true" />}>
            {confirmedQty !== null ? `${formatQuantity(confirmedQty, p.donation.unit)} handed over${p.handedOverAt ? ` at ${formatDateTime(p.handedOverAt)}` : ''}. ` : ''}
            The service fee for this quantity was recorded{showBillingLink ? (
              <>
                {' '}
                (see <Link to="/ngo/billing" className="font-medium underline">Billing</Link>)
              </>
            ) : null}
            .
          </Banner>
        ) : outcome === 'DISPUTED' ? (
          <Banner tone="danger" title="Handover disputed" icon={<TriangleAlert className="size-5" aria-hidden="true" />}>
            The donor confirmed {p.handover?.donorConfirmedQuantity !== null && p.handover?.donorConfirmedQuantity !== undefined ? formatNumber(p.handover.donorConfirmedQuantity) : '—'} and your NGO confirmed{' '}
            {p.handover?.ngoReceivedQuantity !== null && p.handover?.ngoReceivedQuantity !== undefined ? formatNumber(p.handover.ngoReceivedQuantity) : '—'} {unitLabel(p.donation.unit, 2)}. FoodBridge administrators will review it and both sides are notified of the decision. No fee is recorded
            while it is disputed.
          </Banner>
        ) : outcome === 'WAITING' ? (
          <Banner tone="info" title="Waiting for the donor" icon={<Clock className="size-5" aria-hidden="true" />}>
            You confirmed {formatQuantity(p.handover?.ngoReceivedQuantity ?? 0, p.donation.unit)}. The handover completes when the donor confirms the same quantity.
          </Banner>
        ) : p.status === 'VERIFIED' ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              The donor verified the representative. Count the food and enter the quantity actually received{p.handover?.donorConfirmedAt ? ' (the donor has already confirmed their side)' : ''}.
            </p>
            {error ? (
              <Banner tone="danger" live>
                {error}
              </Banner>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Quantity received (${unitLabel(p.donation.unit, 2)})`} error={raw && !valid ? `Enter a whole number from 1 to ${p.donation.quantity}` : undefined} hint={`Reserved: ${formatQuantity(p.donation.quantity, p.donation.unit)}`} required>
                <Input type="number" inputMode="numeric" min={1} max={p.donation.quantity} step={1} value={raw} onChange={(e) => setRaw(e.target.value)} />
              </Field>
              <Field label="Notes" hint="Optional, e.g. condition of the food">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
              </Field>
            </div>
            <Button onClick={submit} loading={confirm.isPending} disabled={!valid}>
              Confirm {valid ? formatQuantity(quantity, p.donation.unit) : 'quantity'} received
            </Button>
            <p className="text-xs text-slate-500">If the quantities differ, the handover is disputed and reviewed by FoodBridge. The service fee is recorded only for an agreed quantity.</p>
          </div>
        ) : ['ASSIGNED', 'EN_ROUTE'].includes(p.status) ? (
          <div className="space-y-3">
            <VerificationChecks checks={p.checks} />
            <p className="text-xs text-slate-400">You can confirm the quantity once the donor has scanned the pass and confirmed the photo ID. Arriving at the location does not count as a handover.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No handover for this pickup ({p.status.toLowerCase().replace(/_/g, ' ')}).</p>
        )}
      </CardBody>
    </Card>
  );
}

/** After the handover: confirm the food reached its destination (completes the collection). */
export function DeliveryCard({ pickup: p }: { pickup: PickupDetail }) {
  const handedOver = p.handover?.ngoReceivedQuantity ?? p.handover?.donorConfirmedQuantity ?? p.donation.quantity;
  const deliver = useConfirmDelivery(p.id);
  const toast = useToast();
  const [raw, setRaw] = useState(String(handedOver));
  const [beneficiaries, setBeneficiaries] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const quantity = Number(raw);
  const valid = raw.trim() !== '' && Number.isInteger(quantity) && quantity >= 0 && quantity <= handedOver;
  const people = beneficiaries.trim() === '' ? undefined : Number(beneficiaries);
  const peopleValid = people === undefined || (Number.isInteger(people) && people >= 0 && people <= 1_000_000);

  if (p.delivery) {
    return (
      <Card>
        <CardHeader title="Delivery" icon={<PackageCheck className="size-4" aria-hidden="true" />} />
        <CardBody>
          <Banner tone="success" title="Delivered">
            {formatQuantity(p.delivery.deliveredQuantity, p.donation.unit)} delivered on {formatDateTime(p.delivery.confirmedAt)}
            {p.delivery.beneficiariesServed !== null ? ` to ${formatNumber(p.delivery.beneficiariesServed)} people` : ''}. Thank you!
          </Banner>
        </CardBody>
      </Card>
    );
  }
  if (!['HANDED_OVER', 'IN_TRANSIT'].includes(p.status)) return null;

  const submit = () => {
    if (!valid || !peopleValid) return;
    setError(null);
    deliver.mutate(
      { deliveredQuantity: quantity, ...(people !== undefined ? { beneficiariesServed: people } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) },
      {
        onSuccess: () => toast.success('Delivery confirmed', 'The collection is complete and the donor has been notified.'),
        onError: (e) => setError(ApiError.from(e).message),
      },
    );
  };

  return (
    <Card>
      <CardHeader title="Confirm delivery" description="When the food has reached the people it is for." icon={<PackageCheck className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        {error ? (
          <Banner tone="danger" live>
            {error}
          </Banner>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Delivered (${unitLabel(p.donation.unit, 2)})`} error={!valid ? `Enter a whole number from 0 to ${handedOver}` : undefined} hint={`Handed over: ${formatNumber(handedOver)}`} required>
            <Input type="number" inputMode="numeric" min={0} max={handedOver} step={1} value={raw} onChange={(e) => setRaw(e.target.value)} />
          </Field>
          <Field label="People served" error={!peopleValid ? 'Enter a whole number' : undefined} hint="Optional">
            <Input type="number" inputMode="numeric" min={0} step={1} value={beneficiaries} onChange={(e) => setBeneficiaries(e.target.value)} />
          </Field>
          <Field label="Notes" hint="Optional">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
        </div>
        <Button onClick={submit} loading={deliver.isPending} disabled={!valid || !peopleValid}>
          Confirm delivery
        </Button>
      </CardBody>
    </Card>
  );
}

export function ReportFailureDialog({ pickupId, open, onClose }: { pickupId: string; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const report = useReportPickupFailure();
  const toast = useToast();
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Report that this pickup failed"
      description="The pickup is marked as failed and its pass is revoked. The food stays reserved for your NGO so you can assign someone else before the deadline. The donor is notified."
      tone="danger"
      confirmLabel="Report failure"
      confirmDisabled={reason.trim().length < 3}
      loading={report.isPending}
      onConfirm={() =>
        report
          .mutateAsync({ pickupId, reason: reason.trim() })
          .then(() => {
            toast.success('Pickup reported as failed', 'Reassign it from Collections before the deadline.');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="What happened?" hint="For example: the vehicle broke down, or the donor was closed." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
