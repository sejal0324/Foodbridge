import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { addressLineFrom, LocationPicker } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from '@/components/ui';
import { DIETARY_TYPES, STORAGE_TYPES, UNITS, type DonationCreateInput, type FoodCategory, type LatLng } from '@/types';
import { applyServerErrors } from '@/utils/formErrors';
import { DIETARY_LABELS, STORAGE_LABELS, UNIT_LABELS } from '@/utils/labels';
import { DONATION_CODE_MAP, DONATION_FIELD_MAP, DONATION_FORM_FIELDS, defaultDonationFormValues, donationFormSchema, toDonationCreateInput, type DonationFormValues } from '../schemas';

export interface DonationFormProps {
  categories: FoodCategory[];
  /** Profile location/address used when the donor does not pick one. */
  profileLocation?: LatLng | null;
  profileAddress?: string | null;
  /** Sends the request; reject with the API error to have it mapped onto the fields. */
  submit: (input: DonationCreateInput) => Promise<unknown>;
  initialValues?: Partial<DonationFormValues>;
}

/**
 * Create-donation form. Client validation mirrors the backend (whole-number
 * quantities, MEALS/PACKETS/BOXES, no future preparation time, deadline after
 * start); server 422/business errors are mapped onto the same fields.
 */
export function DonationForm({ categories, profileLocation, profileAddress, submit, initialValues }: DonationFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<DonationFormValues>({
    resolver: zodResolver(donationFormSchema),
    defaultValues: { ...defaultDonationFormValues(), ...initialValues },
  });
  const categoryId = useWatch({ control, name: 'categoryId' });
  const storageType = useWatch({ control, name: 'storageType' });
  const category = categories.find((c) => c.id === categoryId);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await submit(toDonationCreateInput(values));
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fieldMap: DONATION_FIELD_MAP, fields: DONATION_FORM_FIELDS, codeMap: DONATION_CODE_MAP }));
    }
  });

  const submitWith = (publish: boolean) => {
    setValue('publish', publish);
    void onSubmit();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submitWith(true);
      }}
      className="space-y-6"
      aria-label="Donation details"
    >
      {formError ? (
        <Banner tone="danger" live>
          {formError}
        </Banner>
      ) : null}

      <Card>
        <CardHeader title="Food" description="Describe the food that already exists and is ready to be collected." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Food name" error={errors.foodName?.message} required className="sm:col-span-2">
            <Input placeholder="e.g. Veg biryani with raita" {...register('foodName')} />
          </Field>
          <Field label="Category" error={errors.categoryId?.message} required>
            <Select placeholder="Choose a category" {...register('categoryId')} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Diet" error={errors.dietaryType?.message} required>
            <Select {...register('dietaryType')} options={DIETARY_TYPES.map((d) => ({ value: d, label: DIETARY_LABELS[d] }))} />
          </Field>
          <Field label="Quantity" error={errors.quantity?.message} hint="Whole number only" required>
            <Input type="number" inputMode="numeric" min={1} step={1} {...register('quantity', { valueAsNumber: true })} />
          </Field>
          <Field label="Unit" error={errors.unit?.message} required>
            <Select {...register('unit')} options={UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))} />
          </Field>
          <Field label="Description" error={errors.description?.message} hint="Packaging, portions, allergens, anything that helps the NGO." className="sm:col-span-2">
            <Textarea {...register('description')} maxLength={2000} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Preparation and storage" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Prepared at (IST)" error={errors.preparedAt?.message} required>
            <Input type="datetime-local" {...register('preparedAt')} />
          </Field>
          <Field label="Best before (IST)" error={errors.bestBefore?.message} hint="Optional, mainly for packaged food">
            <Input type="datetime-local" {...register('bestBefore')} />
          </Field>
          <Field label="Storage" error={errors.storageType?.message} required>
            <Select {...register('storageType')} options={STORAGE_TYPES.map((s) => ({ value: s, label: STORAGE_LABELS[s] }))} />
          </Field>
          <Field label="Storage notes" error={errors.storageNotes?.message}>
            <Input placeholder="e.g. kept in insulated containers" {...register('storageNotes')} />
          </Field>
          {category?.requiresRefrigeration && storageType !== 'REFRIGERATED' && storageType !== 'FROZEN' ? (
            <Banner tone="warning" className="sm:col-span-2">
              {category.name} usually needs refrigeration. You can still list it; FoodBridge will flag it for extra care.
            </Banner>
          ) : null}
          {category?.reviewFlagHoursAfterPreparation ? (
            <p className="text-xs text-slate-400 sm:col-span-2">
              FoodBridge flags {category.name.toLowerCase()} for extra care when the pickup deadline is more than {category.reviewFlagHoursAfterPreparation} h after preparation.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pickup" description="When and where an NGO representative can collect the food." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Available from (IST)" error={errors.pickupAvailableFrom?.message} hint="Leave as now if it is ready">
            <Input type="datetime-local" {...register('pickupAvailableFrom')} />
          </Field>
          <Field label="Pickup deadline (IST)" error={errors.pickupDeadline?.message} hint="Reservations close 30 minutes before the deadline" required>
            <Input type="datetime-local" {...register('pickupDeadline')} />
          </Field>
          <Field label="Pickup address" error={errors.address?.message} hint={profileAddress ? `Leave empty to use your profile address: ${profileAddress}` : 'Required if your profile has no address'} className="sm:col-span-2">
            <Input autoComplete="street-address" {...register('address')} />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium text-slate-200">Pickup location</p>
            <p className="mb-3 text-xs text-slate-400">
              {profileLocation
                ? 'Defaults to your profile location (shown on the map). Search, use your current location or click the map only if the food is somewhere else.'
                : 'Your profile has no location yet: search for the address, use your current location or click the map.'}
            </p>
            <Controller
              control={control}
              name="location"
              render={({ field }) => (
                <LocationPicker
                  value={field.value}
                  onChange={field.onChange}
                  label="Pickup location"
                  fallback={profileLocation ? { position: profileLocation, title: 'Your profile location' } : null}
                  emptyHint={profileLocation ? `Using your profile location (${profileLocation.lat.toFixed(4)}, ${profileLocation.lng.toFixed(4)}).` : 'No location selected.'}
                  onAddressSelect={(r) => {
                    if (!getValues('address').trim()) setValue('address', [addressLineFrom(r), r.city, r.state, r.postalCode].filter(Boolean).join(', ').slice(0, 300), { shouldValidate: true });
                  }}
                />
              )}
            />
            {errors.location?.message ? (
              <p role="alert" className="mt-1 text-xs font-medium text-red-300">
                {errors.location.message}
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden="true" />
            <Checkbox
              {...register('safetyConfirmed')}
              error={errors.safetyConfirmed?.message}
              label="I confirm this food is safe and fit for people to eat"
              description="I am responsible for the food I donate: it was prepared, stored and handled hygienically, and the details above are accurate. FoodBridge does not inspect or certify food safety."
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => submitWith(false)} disabled={isSubmitting}>
              Save as draft
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Publish donation
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
