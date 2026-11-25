import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, Button, Checkbox, ConfirmDialog, Dialog, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { STORAGE_TYPES, type Offer, type Unit } from '@/types';
import { formatQuantity, toIstInputValue, unitLabel } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { STORAGE_LABELS } from '@/utils/labels';
import { useCancelOffer, useConfirmOffer } from '../api';
import { offerConfirmSchema, toOfferConfirmInput, type OfferConfirmValues } from '../schemas';

const CANCELLABLE = ['PROPOSED', 'ACCEPTED', 'RESERVED', 'PICKUP_ASSIGNED'];

/** Confirm (when ACCEPTED) and cancel buttons for one of the donor's offers. */
export function OfferActions({ offer, unit }: { offer: Offer; unit: Unit }) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  return (
    <>
      {offer.status === 'ACCEPTED' && offer.acceptedQuantity ? (
        <Button size="sm" onClick={() => setConfirming(true)}>
          Confirm food is ready
        </Button>
      ) : null}
      {CANCELLABLE.includes(offer.status) ? (
        <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
          Withdraw offer
        </Button>
      ) : null}
      {confirming && offer.acceptedQuantity ? <ConfirmOfferDialog offer={offer} acceptedQuantity={offer.acceptedQuantity} unit={unit} onClose={() => setConfirming(false)} /> : null}
      {cancelling ? <CancelOfferDialog offer={offer} onClose={() => setCancelling(false)} /> : null}
    </>
  );
}

function ConfirmOfferDialog({ offer, acceptedQuantity, unit, onClose }: { offer: Offer; acceptedQuantity: number; unit: Unit; onClose: () => void }) {
  const schema = useMemo(() => offerConfirmSchema(acceptedQuantity), [acceptedQuantity]);
  const confirm = useConfirmOffer();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OfferConfirmValues>({
    resolver: zodResolver(schema),
    defaultValues: { confirmedQuantity: acceptedQuantity, preparedAt: toIstInputValue(new Date()), storageType: 'HOT_HELD', storageNotes: '', safetyConfirmed: false },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await confirm.mutateAsync({ offerId: offer.id, input: toOfferConfirmInput(v) });
      toast.success('Food confirmed and reserved', 'The NGO will assign a representative to collect it.');
      onClose();
    } catch (err) {
      setFormError(
        applyServerErrors(err, setError, {
          fields: ['confirmedQuantity', 'preparedAt', 'storageType', 'storageNotes', 'safetyConfirmed'],
          codeMap: { CONFIRMATION_EXCEEDS_ACCEPTED: 'confirmedQuantity', PREPARED_IN_FUTURE: 'preparedAt' },
        }),
      );
    }
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Confirm the food is ready"
      description={`The NGO accepted ${formatQuantity(acceptedQuantity, unit)} of ${offer.foodName}. Confirm the actual quantity; anything less is reopened for other donors.`}
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} loading={isSubmitting}>
            Confirm and reserve
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4 sm:grid-cols-2">
        {formError ? (
          <Banner tone="danger" live className="sm:col-span-2">
            {formError}
          </Banner>
        ) : null}
        <Field label={`Actual quantity (${unitLabel(unit, 2)})`} error={errors.confirmedQuantity?.message} required>
          <Input type="number" inputMode="numeric" min={1} max={acceptedQuantity} step={1} {...register('confirmedQuantity', { valueAsNumber: true })} data-autofocus />
        </Field>
        <Field label="Prepared at (IST)" error={errors.preparedAt?.message} required>
          <Input type="datetime-local" {...register('preparedAt')} />
        </Field>
        <Field label="Storage" error={errors.storageType?.message} required>
          <Select {...register('storageType')} options={STORAGE_TYPES.map((s) => ({ value: s, label: STORAGE_LABELS[s] }))} />
        </Field>
        <Field label="Storage notes" error={errors.storageNotes?.message}>
          <Input {...register('storageNotes')} />
        </Field>
        <Checkbox
          className="sm:col-span-2"
          {...register('safetyConfirmed')}
          error={errors.safetyConfirmed?.message}
          label="I confirm this food is safe and fit for people to eat"
          description="I am responsible for the food I donate. FoodBridge does not certify food safety."
        />
      </form>
    </Dialog>
  );
}

function CancelOfferDialog({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useCancelOffer();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone="danger"
      title="Withdraw this offer?"
      description={offer.status === 'PROPOSED' ? 'The NGO is notified.' : 'The NGO is notified and any reserved quantity is released so they can find another donor.'}
      confirmLabel="Withdraw offer"
      cancelLabel="Keep offer"
      confirmDisabled={reason.trim().length < 3}
      loading={cancel.isPending}
      onConfirm={() =>
        cancel
          .mutateAsync({ offerId: offer.id, reason: reason.trim() })
          .then(() => {
            toast.success('Offer withdrawn');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason" hint="At least 3 characters; shared with the NGO." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
