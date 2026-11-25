import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Banner, Button, Checkbox, Dialog, Field, Input, Select, Switch, Textarea, useToast } from '@/components/ui';
import { DIETARY_TYPES, STORAGE_TYPES, type AssistanceRequestDetail } from '@/types';
import { formatQuantity, unitLabel } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { DIETARY_LABELS, STORAGE_LABELS } from '@/utils/labels';
import { useCreateOffer } from '../api';
import { OFFER_CODE_MAP, OFFER_FIELD_MAP, defaultOfferValues, offerFormSchema, toOfferCreateInput, type OfferFormValues } from '../schemas';

const FIELDS = ['quantity', 'foodName', 'dietaryType', 'pickupAvailableFrom', 'pickupDeadline', 'notes', 'preparedAt', 'storageType', 'safetyConfirmed'] as const;

/** Offer full or partial quantity for an NGO request (optionally food that is ready now). */
export function OfferFormDialog({ request, onClose }: { request: AssistanceRequestDetail; onClose: () => void }) {
  const vegOnly = request.dietaryRequirement === 'VEG_ONLY';
  const max = Math.max(1, request.quantityRemaining);
  const schema = useMemo(() => offerFormSchema(max, vegOnly), [max, vegOnly]);
  const create = useCreateOffer(request.id);
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<OfferFormValues>({ resolver: zodResolver(schema), defaultValues: defaultOfferValues(request.neededFrom, max, vegOnly) });
  const readyNow = useWatch({ control, name: 'readyNow' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const offer = await create.mutateAsync(toOfferCreateInput(values));
      toast.success('Offer sent', `${request.ngo.name} has been notified of your ${formatQuantity(offer.offeredQuantity, request.unit)}.`);
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: FIELDS, fieldMap: OFFER_FIELD_MAP, codeMap: OFFER_CODE_MAP }));
    }
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Offer food to ${request.ngo.name}`}
      description={`They still need ${formatQuantity(request.quantityRemaining, request.unit)} (${request.category.name.toLowerCase()}, ${DIETARY_LABELS[request.dietaryRequirement].toLowerCase()}). Partial offers are welcome.`}
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} loading={isSubmitting}>
            Send offer
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
        <Field label={`Quantity (${unitLabel(request.unit, 2)})`} error={errors.quantity?.message} hint={`Up to ${max}`} required>
          <Input type="number" inputMode="numeric" min={1} max={max} step={1} {...register('quantity', { valueAsNumber: true })} data-autofocus />
        </Field>
        <Field label="Diet" error={errors.dietaryType?.message} required hint={vegOnly ? 'This request is for vegetarian food only' : undefined}>
          <Select {...register('dietaryType')} options={DIETARY_TYPES.map((d) => ({ value: d, label: DIETARY_LABELS[d], disabled: vegOnly && d !== 'VEG' }))} />
        </Field>
        <Field label="Food name" error={errors.foodName?.message} required className="sm:col-span-2">
          <Input placeholder="e.g. Veg pulao" {...register('foodName')} />
        </Field>
        <Field label="Pickup from (IST)" error={errors.pickupAvailableFrom?.message} required>
          <Input type="datetime-local" {...register('pickupAvailableFrom')} />
        </Field>
        <Field label="Pickup deadline (IST)" error={errors.pickupDeadline?.message} required>
          <Input type="datetime-local" {...register('pickupDeadline')} />
        </Field>
        <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} maxLength={1000} />
        </Field>
        <div className="space-y-4 rounded-xl border border-white/10 p-4 sm:col-span-2">
          <Switch
            checked={readyNow}
            onChange={(v) => setValue('readyNow', v, { shouldValidate: false })}
            label="The food is ready now"
            description="If it already exists, it is reserved as soon as the NGO accepts. Otherwise you confirm the actual quantity after acceptance."
          />
          {readyNow ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prepared at (IST)" error={errors.preparedAt?.message} required>
                <Input type="datetime-local" {...register('preparedAt')} />
              </Field>
              <Field label="Storage" error={errors.storageType?.message} required>
                <Select {...register('storageType')} options={STORAGE_TYPES.map((s) => ({ value: s, label: STORAGE_LABELS[s] }))} />
              </Field>
              <Checkbox
                className="sm:col-span-2"
                {...register('safetyConfirmed')}
                error={errors.safetyConfirmed?.message}
                label="I confirm this food is safe and fit for people to eat"
                description="I am responsible for the food I donate. FoodBridge does not certify food safety."
              />
            </div>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
