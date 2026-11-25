import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, ConfirmDialog, Field, Input, Textarea, useToast } from '@/components/ui';
import { formatINR } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { useRecordManualPayment } from '../api';
import { outstandingOf } from '../helpers';
import { manualPaymentSchema, toManualPaymentInput, type ManualPaymentValues } from '../schemas';
import type { Invoice } from '../types';

/** Records an offline payment (bank transfer, cheque) against an invoice: POST /admin/payments/manual (audited). */
export function ManualPaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const outstanding = outstandingOf(invoice);
  const schema = useMemo(() => manualPaymentSchema(outstanding), [outstanding]);
  const record = useRecordManualPayment();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ManualPaymentValues>({ resolver: zodResolver(schema), defaultValues: { amount: outstanding > 0 ? outstanding.toFixed(2) : '', reference: '' } });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await record.mutateAsync(toManualPaymentInput(invoice.id, v));
      toast.success('Offline payment recorded', `${formatINR(Number(v.amount))} against ${invoice.invoiceNumber}.`);
      onClose();
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['amount', 'reference'], codeMap: { OVERPAYMENT: 'amount' } });
      if (message) setFormError(message);
    }
  });

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Record an offline payment for ${invoice.invoiceNumber}`}
      description={`${invoice.ngo.name} · outstanding ${formatINR(outstanding)} of ${formatINR(Number(invoice.total))}`}
      confirmLabel="Record payment"
      loading={record.isPending}
      onConfirm={() => submit()}
    >
      <div className="space-y-4">
        <Banner tone="info">
          Use this only for money received outside FoodBridge (bank transfer, cheque). The payment is labelled <strong>MANUAL</strong>, linked to your account and recorded in the audit log. The invoice is marked
          paid when nothing is outstanding.
        </Banner>
        <Field label="Amount received (₹)" required error={errors.amount?.message} hint={`More than ₹0 and at most ${formatINR(outstanding)}.`}>
          <Input type="number" inputMode="decimal" min={0.01} max={outstanding} step="0.01" {...register('amount')} data-autofocus />
        </Field>
        <Field label="Reference" required error={errors.reference?.message} hint="Bank transaction ID, UTR or cheque number.">
          <Textarea {...register('reference')} maxLength={300} rows={2} />
        </Field>
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
