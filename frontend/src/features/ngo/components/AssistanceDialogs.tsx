import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, Button, ConfirmDialog, Dialog, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import { URGENCIES, type AssistanceRequest } from '@/types';
import { applyServerErrors } from '@/utils/formErrors';
import { URGENCY_LABELS } from '@/utils/labels';
import { useCancelAssistanceRequest, useUpdateAssistanceRequest } from '../api';
import { assistanceEditSchema, toAssistanceUpdate, toEditValues, type AssistanceEditValues } from '../schemas';

const EDIT_FIELDS = ['quantityRequired', 'neededFrom', 'neededUntil', 'urgency', 'beneficiariesCount', 'reason', 'additionalRequirements'];

/**
 * Edit an assistance request with optimistic locking: a `409 STALE_VERSION`
 * (someone else changed it) offers to load the latest values instead of overwriting them.
 */
export function EditAssistanceDialog({ request, onReload, onClose }: { request: AssistanceRequest; onReload: () => Promise<AssistanceRequest | undefined>; onClose: () => void }) {
  const [current, setCurrent] = useState(request);
  const [stale, setStale] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const update = useUpdateAssistanceRequest(request.id);
  const toast = useToast();
  const schema = useMemo(() => assistanceEditSchema(current.quantityCommitted), [current.quantityCommitted]);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AssistanceEditValues>({ resolver: zodResolver(schema), defaultValues: toEditValues(request) });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    const body = toAssistanceUpdate(v, current);
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(body);
      toast.success('Request updated', 'Donors see the new details.');
      onClose();
    } catch (err) {
      const e = ApiError.from(err);
      if (e.code === 'STALE_VERSION') {
        setStale(true);
        return;
      }
      setFormError(applyServerErrors(err, setError, { fields: EDIT_FIELDS, codeMap: { QUANTITY_BELOW_COMMITTED: 'quantityRequired', INVALID_WINDOW: 'neededUntil' } }));
    }
  });

  const reload = async () => {
    setReloading(true);
    try {
      const latest = await onReload();
      if (latest) {
        setCurrent(latest);
        reset(toEditValues(latest));
      }
      setStale(false);
    } finally {
      setReloading(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit request"
      description="Category, diet, unit and location cannot change; cancel and create a new request for that."
      size="lg"
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isSubmitting} disabled={!isDirty || stale}>
            Save changes
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
        {stale ? (
          <Banner
            tone="warning"
            title="Someone else changed this request"
            live
            className="sm:col-span-2"
            actions={
              <Button size="sm" variant="secondary" loading={reloading} onClick={() => void reload()}>
                Load latest version
              </Button>
            }
          >
            Your changes were not saved, so nothing was overwritten. Load the latest version, then apply your changes again.
          </Banner>
        ) : null}
        {formError ? (
          <Banner tone="danger" live className="sm:col-span-2">
            {formError}
          </Banner>
        ) : null}
        <Field label="Quantity needed" error={errors.quantityRequired?.message} hint={current.quantityCommitted > 0 ? `At least ${current.quantityCommitted} (already committed by donors)` : 'Whole numbers only'} required>
          <Input type="number" inputMode="numeric" min={Math.max(1, current.quantityCommitted)} step={1} {...register('quantityRequired', { valueAsNumber: true })} data-autofocus />
        </Field>
        <Field label="People it will feed" error={errors.beneficiariesCount?.message} required>
          <Input type="number" inputMode="numeric" min={1} step={1} {...register('beneficiariesCount', { valueAsNumber: true })} />
        </Field>
        <Field label="Needed from (IST)" error={errors.neededFrom?.message} required>
          <Input type="datetime-local" {...register('neededFrom')} />
        </Field>
        <Field label="Needed until (IST)" error={errors.neededUntil?.message} required>
          <Input type="datetime-local" {...register('neededUntil')} />
        </Field>
        <Field label="Urgency" error={errors.urgency?.message} required>
          <Select {...register('urgency')} options={URGENCIES.map((u) => ({ value: u, label: URGENCY_LABELS[u] }))} />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Why you need it" error={errors.reason?.message} className="sm:col-span-2">
          <Textarea {...register('reason')} maxLength={1000} />
        </Field>
        <Field label="Additional requirements" error={errors.additionalRequirements?.message} className="sm:col-span-2">
          <Textarea {...register('additionalRequirements')} maxLength={1000} />
        </Field>
      </form>
    </Dialog>
  );
}

export function CancelAssistanceDialog({ request, onClose }: { request: AssistanceRequest; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useCancelAssistanceRequest(request.id);
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone="danger"
      title="Cancel this request?"
      description="Pending offers are declined and food reserved for this request is released back to the donors. This cannot be undone."
      confirmLabel="Cancel request"
      cancelLabel="Keep request"
      confirmDisabled={reason.trim().length < 3}
      loading={cancel.isPending}
      onConfirm={() =>
        cancel
          .mutateAsync(reason.trim())
          .then(() => {
            toast.success('Request cancelled', 'Donors with offers have been notified.');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason" hint="At least 3 characters; shared with donors who offered." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
