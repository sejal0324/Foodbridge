import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Banner, Button, ConfirmDialog, Field, Input, Textarea, useToast } from '@/components/ui';
import { formatQuantity } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { useResolveDispute } from '../api';
import { disputeResolveSchema, toDisputeResolveBody, type DisputeResolveValues } from '../schemas';
import type { Dispute } from '../types';

/**
 * Resolve a handover dispute (PATCH /admin/disputes/:id/resolve):
 * - CONFIRM_QUANTITY records the handover at an agreed quantity (1 to the
 *   allocated quantity); donor points and the NGO fee are then recorded from it.
 * - CANCEL_COLLECTION cancels the collection with no points and no fee.
 */
export function DisputeResolveDialog({ dispute, unit, onClose }: { dispute: Dispute; unit?: string; onClose: () => void }) {
  const resolve = useResolveDispute();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => disputeResolveSchema(dispute.allocatedQuantity), [dispute.allocatedQuantity]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<DisputeResolveValues>({ resolver: zodResolver(schema), defaultValues: { outcome: 'CONFIRM_QUANTITY', resolvedQuantity: '', resolution: '' } });
  const outcome = useWatch({ control, name: 'outcome' });
  const qty = (n: number | null) => (n === null ? '—' : unit ? formatQuantity(n, unit) : `${n} units`);

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await resolve.mutateAsync({ disputeId: dispute.id, body: toDisputeResolveBody(values) });
      toast.success('Dispute resolved', values.outcome === 'CONFIRM_QUANTITY' ? 'Points and the NGO fee were recorded from the confirmed quantity.' : 'The collection was cancelled with no points and no fee.');
      onClose();
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['resolvedQuantity', 'resolution'], codeMap: { INVALID_RESOLVED_QUANTITY: 'resolvedQuantity' } });
      if (message) setFormError(message);
    }
  });

  const confirm = outcome === 'CONFIRM_QUANTITY';
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone={confirm ? 'primary' : 'danger'}
      title={`Resolve the dispute for ${dispute.foodName}`}
      description={`${dispute.donorName} says ${qty(dispute.donorQuantity)} · ${dispute.ngoName} says ${qty(dispute.ngoQuantity)} · allocated ${qty(dispute.allocatedQuantity)}`}
      confirmLabel={confirm ? 'Confirm quantity' : 'Cancel collection'}
      loading={resolve.isPending}
      onConfirm={() => submit()}
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-200">Outcome</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3 has-[:checked]:border-brand-400/60">
            <input type="radio" value="CONFIRM_QUANTITY" {...register('outcome')} className="mt-1 accent-brand-600" />
            <span>
              <span className="block text-sm font-medium text-white">Confirm a quantity</span>
              <span className="block text-xs text-slate-400">Record the handover at an agreed quantity.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3 has-[:checked]:border-red-400/60">
            <input type="radio" value="CANCEL_COLLECTION" {...register('outcome')} className="mt-1 accent-brand-600" />
            <span>
              <span className="block text-sm font-medium text-white">Cancel the collection</span>
              <span className="block text-xs text-slate-400">No points for the donor and no fee for the NGO.</span>
            </span>
          </label>
        </fieldset>

        {confirm ? (
          <>
            <Field label="Confirmed quantity" required error={errors.resolvedQuantity?.message} hint={`A whole number from 1 to ${dispute.allocatedQuantity} (the allocated quantity).`}>
              <Input type="number" inputMode="numeric" min={1} max={dispute.allocatedQuantity} step={1} {...register('resolvedQuantity')} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {dispute.donorQuantity !== null && dispute.donorQuantity >= 1 && dispute.donorQuantity <= dispute.allocatedQuantity ? (
                <Button size="sm" variant="ghost" onClick={() => setValue('resolvedQuantity', String(dispute.donorQuantity), { shouldValidate: true })}>
                  Use donor’s figure ({dispute.donorQuantity})
                </Button>
              ) : null}
              {dispute.ngoQuantity !== null && dispute.ngoQuantity >= 1 && dispute.ngoQuantity <= dispute.allocatedQuantity ? (
                <Button size="sm" variant="ghost" onClick={() => setValue('resolvedQuantity', String(dispute.ngoQuantity), { shouldValidate: true })}>
                  Use NGO’s figure ({dispute.ngoQuantity})
                </Button>
              ) : null}
            </div>
            <Banner tone="info">Donor reward points and the NGO’s service fee are then recorded from this quantity, exactly once.</Banner>
          </>
        ) : (
          <Banner tone="warning">The collection is cancelled and the reserved quantity released. No reward points are credited and no service fee is charged.</Banner>
        )}

        <Field label="Resolution" required error={errors.resolution?.message} hint="Shared with the donor and the NGO and recorded in the audit log.">
          <Textarea {...register('resolution')} maxLength={2000} rows={3} />
        </Field>
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}
      </form>
    </ConfirmDialog>
  );
}
