import { zodResolver } from '@hookform/resolvers/zod';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { LocationPicker } from '@/components/map';
import { Banner, Button, Card, CardBody, Field, FieldSet, Input, Select, Textarea } from '@/components/ui';
import { useFoodCategories } from '@/features/donations/api';
import { UNITS, URGENCIES } from '@/types';
import { addressLineFrom } from '@/components/map';
import { unitLabel } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { UNIT_LABELS, URGENCY_LABELS } from '@/utils/labels';
import { ASSISTANCE_CODE_MAP, ASSISTANCE_FIELD_MAP, ASSISTANCE_FORM_FIELDS, assistanceFormSchema, toAssistanceCreateInput, type AssistanceFormValues } from '../schemas';
import type { AssistanceCreateInput } from '@/types';

export interface AssistanceFormProps {
  defaultValues: AssistanceFormValues;
  /** The NGO's own location, shown on the map as the default delivery point. */
  ngoLocation: { lat: number; lng: number } | null;
  onSubmit: (input: AssistanceCreateInput) => Promise<unknown>;
}

const URGENCY_HINT: Record<string, string> = {
  LOW: 'Flexible; any time in the window',
  MEDIUM: 'Normal planning',
  HIGH: 'Needed soon; donors see it first',
  CRITICAL: 'Urgent shortfall (use sparingly)',
};

/** Create form for a food assistance request (Workflow B). */
export function AssistanceForm({ defaultValues, ngoLocation, onSubmit }: AssistanceFormProps) {
  const categories = useFoodCategories();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<AssistanceFormValues>({ resolver: zodResolver(assistanceFormSchema), defaultValues });
  const unit = useWatch({ control, name: 'unit' });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await onSubmit(toAssistanceCreateInput(v));
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ASSISTANCE_FORM_FIELDS, fieldMap: ASSISTANCE_FIELD_MAP, codeMap: ASSISTANCE_CODE_MAP }));
    }
  });

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-6" aria-label="New assistance request">
      {formError ? (
        <Banner tone="danger" live>
          {formError}
        </Banner>
      ) : null}
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FieldSet legend="What food do you need?" className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <Field label="Food category" error={errors.categoryId?.message} required>
              <Select {...register('categoryId')} placeholder={categories.isPending ? 'Loading…' : 'Choose a category'} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="Dietary requirement" error={errors.dietaryRequirement?.message} required>
              <Select
                {...register('dietaryRequirement')}
                options={[
                  { value: 'VEG_ONLY', label: 'Vegetarian only' },
                  { value: 'ANY', label: 'Vegetarian or non-vegetarian' },
                ]}
              />
            </Field>
            <Field label="Quantity" error={errors.quantityRequired?.message} hint="Whole numbers only" required>
              <Input type="number" inputMode="numeric" min={1} step={1} {...register('quantityRequired', { valueAsNumber: true })} />
            </Field>
            <Field label="Unit" error={errors.unit?.message} required>
              <Select {...register('unit')} options={UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))} />
            </Field>
          </FieldSet>

          <FieldSet legend="When do you need it? (IST)" className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <Field label="Needed from" error={errors.neededFrom?.message} required>
              <Input type="datetime-local" {...register('neededFrom')} />
            </Field>
            <Field label="Needed until" error={errors.neededUntil?.message} required>
              <Input type="datetime-local" {...register('neededUntil')} />
            </Field>
            <Field label="Urgency" error={errors.urgency?.message} required>
              <Select {...register('urgency')} options={URGENCIES.map((u) => ({ value: u, label: `${URGENCY_LABELS[u]} — ${URGENCY_HINT[u] ?? ''}` }))} />
            </Field>
            <Field label="People it will feed" error={errors.beneficiariesCount?.message} required>
              <Input type="number" inputMode="numeric" min={1} step={1} {...register('beneficiariesCount', { valueAsNumber: true })} />
            </Field>
          </FieldSet>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <FieldSet legend="Where should donors deliver or hand over?" hint="Defaults to your NGO’s location. Any place in India can be chosen.">
            <Controller
              control={control}
              name="location"
              render={({ field }) => (
                <LocationPicker
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  label="Delivery location"
                  emptyHint="No location chosen: your NGO’s profile location is used."
                  fallback={ngoLocation ? { position: ngoLocation, title: 'Your NGO (profile location)' } : null}
                  onAddressSelect={(r) => {
                    if (!getValues('address').trim()) setValue('address', addressLineFrom(r), { shouldDirty: true, shouldValidate: true });
                  }}
                />
              )}
            />
            {errors.location?.message ? (
              <p role="alert" className="mt-1 text-xs font-medium text-red-300">
                {errors.location.message}
              </p>
            ) : null}
          </FieldSet>
          <Field label="Address" error={errors.address?.message} hint="Shown to donors who offer food">
            <Input autoComplete="street-address" {...register('address')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="grid gap-4">
          <Field label="Why you need it" error={errors.reason?.message} hint="Optional; helps donors decide (max 1000 characters)">
            <Textarea {...register('reason')} maxLength={1000} />
          </Field>
          <Field label="Additional requirements" error={errors.additionalRequirements?.message} hint={`Optional, e.g. packaging or “no onion/garlic” (max 1000 characters)`}>
            <Textarea {...register('additionalRequirements')} maxLength={1000} />
          </Field>
          <p className="text-xs text-slate-400">
            Matching donors nearby are notified. You choose which offers to accept; a service fee applies only to {unitLabel(unit, 2)} actually handed over and confirmed by both sides.
          </p>
          <div>
            <Button type="submit" loading={isSubmitting} leftIcon={<Send className="size-4" aria-hidden="true" />}>
              Publish request
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
