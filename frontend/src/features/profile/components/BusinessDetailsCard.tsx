import { zodResolver } from '@hookform/resolvers/zod';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { fillEmptyAddressFields, LocationPicker } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, Field, Input, Select, StateSelect, useToast } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-context';
import { BUSINESS_TYPES, type DonorProfile } from '@/types';
import { applyServerErrors } from '@/utils/formErrors';
import { isWithinIndiaBounds } from '@/utils/india';
import { BUSINESS_TYPE_LABELS } from '@/utils/labels';
import { useUpdateDonorProfile } from '../api';

const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);
const schema = z.object({
  businessName: z.string().trim().min(2, 'Enter at least 2 characters').max(160),
  businessType: z.enum(BUSINESS_TYPES),
  licenseNumber: optional(60),
  contactPhone: z.union([z.literal(''), z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +919876543210')]),
  addressLine: optional(300),
  city: optional(100),
  state: optional(100),
  postalCode: z.union([z.literal(''), z.string().trim().regex(/^[0-9A-Za-z -]{3,12}$/, 'Enter a valid postal code')]),
  location: z.object({ lat: z.number(), lng: z.number() }).refine(isWithinIndiaBounds, 'Choose a location in India').nullable(),
});
type Values = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function toValues(p: DonorProfile): Values {
  return {
    businessName: p.businessName,
    businessType: p.businessType,
    licenseNumber: p.licenseNumber ?? '',
    contactPhone: p.contactPhone ?? '',
    addressLine: p.addressLine ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    postalCode: p.postalCode ?? '',
    location: p.location,
  };
}

export function BusinessDetailsCard({ profile }: { profile: DonorProfile }) {
  const update = useUpdateDonorProfile();
  const { reloadUser } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    getValues,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(profile) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    // The API ignores omitted fields; empty optional text is omitted (it cannot be cleared to null).
    const opt = (s: string) => (s.trim() ? s.trim() : undefined);
    try {
      const saved = await update.mutateAsync({
        businessName: v.businessName.trim(),
        businessType: v.businessType,
        licenseNumber: opt(v.licenseNumber),
        contactPhone: opt(v.contactPhone),
        addressLine: opt(v.addressLine),
        city: opt(v.city),
        state: opt(v.state),
        postalCode: opt(v.postalCode),
        ...(v.location ? { location: v.location } : {}),
      });
      reset(toValues(saved));
      void reloadUser();
      toast.success('Business details saved');
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: FIELDS, fieldMap: { 'location.lat': 'location', 'location.lng': 'location' }, codeMap: { LOCATION_OUTSIDE_INDIA: 'location' } }));
    }
  });

  return (
    <Card>
      <CardHeader title="Business details" description={`Contact email: ${profile.contactEmail ?? '—'}`} icon={<Building2 className="size-4" aria-hidden="true" />} />
      <CardBody>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4 sm:grid-cols-2">
          {formError ? (
            <Banner tone="danger" live className="sm:col-span-2">
              {formError}
            </Banner>
          ) : null}
          <Field label="Business name" error={errors.businessName?.message} required>
            <Input {...register('businessName')} />
          </Field>
          <Field label="Business type" error={errors.businessType?.message} required>
            <Select {...register('businessType')} options={BUSINESS_TYPES.map((b) => ({ value: b, label: BUSINESS_TYPE_LABELS[b] }))} />
          </Field>
          <Field label="Licence number (FSSAI or trade)" error={errors.licenseNumber?.message}>
            <Input {...register('licenseNumber')} />
          </Field>
          <Field label="Contact phone" error={errors.contactPhone?.message} hint="International format, e.g. +919876543210">
            <Input type="tel" {...register('contactPhone')} />
          </Field>
          <Field label="Address" error={errors.addressLine?.message} className="sm:col-span-2">
            <Input autoComplete="street-address" {...register('addressLine')} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input {...register('city')} />
          </Field>
          <Field label="State / union territory" error={errors.state?.message}>
            <StateSelect current={profile.state} {...register('state')} />
          </Field>
          <Field label="Postal code" error={errors.postalCode?.message}>
            <Input {...register('postalCode')} />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-200">Pickup location</p>
            <Controller
              control={control}
              name="location"
              render={({ field }) => (
                <LocationPicker
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  label="Business location"
                  allowClear={false}
                  emptyHint="No location set: NGOs cannot be matched until you set one."
                  onAddressSelect={(r) =>
                    fillEmptyAddressFields(r, {
                      get: (f) => getValues(f),
                      set: (f, v) => setValue(f, v, { shouldDirty: true, shouldValidate: true }),
                    })
                  }
                />
              )}
            />
            {errors.location?.message ? (
              <p role="alert" className="mt-1 text-xs font-medium text-red-300">
                {errors.location.message}
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save details
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
