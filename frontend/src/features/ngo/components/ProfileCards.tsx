import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Filter } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { fillEmptyAddressFields, LocationPicker } from '@/components/map';
import { Banner, Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Field, FieldSet, Input, Skeleton, StateSelect, Switch, Textarea, useToast } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-context';
import { useFoodCategories } from '@/features/donations/api';
import { applyServerErrors } from '@/utils/formErrors';
import { isWithinIndiaBounds } from '@/utils/india';
import { useSetFoodPreferences, useUpdateNgoProfile } from '../api';
import type { NgoProfile, NgoProfileUpdate } from '../types';

const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);
const optionalInt = (max: number) => z.number().int('Use a whole number').positive('Must be more than 0').max(max, `At most ${max.toLocaleString('en-IN')}`).nullable();
/** Empty number inputs become null instead of NaN. */
const numberOrNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

const schema = z
  .object({
    organizationName: z.string().trim().min(2, 'Enter at least 2 characters').max(160),
    registrationNumber: optional(60),
    contactPhone: z.union([z.literal(''), z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +919876543210')]),
    addressLine: optional(300),
    city: optional(100),
    state: optional(100),
    postalCode: z.union([z.literal(''), z.string().trim().regex(/^[0-9A-Za-z -]{3,12}$/, 'Enter a valid postal code')]),
    location: z.object({ lat: z.number(), lng: z.number() }).refine(isWithinIndiaBounds, 'Choose a location in India').nullable(),
    acceptsVeg: z.boolean(),
    acceptsNonVeg: z.boolean(),
    maxDailyCapacity: optionalInt(100_000),
    collectionRadiusKm: z.number({ error: 'Enter a radius' }).positive('Must be more than 0').max(100, 'At most 100 km'),
    beneficiariesCount: z.number({ error: 'Enter a number' }).int('Use a whole number').min(0).max(1_000_000),
    beneficiaryDescription: optional(1000),
    hasRefrigeration: z.boolean(),
    defaultVehicleCapacity: optionalInt(100_000),
  })
  .refine((v) => v.acceptsVeg || v.acceptsNonVeg, { message: 'Accept at least one: vegetarian or non-vegetarian', path: ['acceptsNonVeg'] });
type Values = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function toValues(p: NgoProfile): Values {
  return {
    organizationName: p.organizationName,
    registrationNumber: p.registrationNumber ?? '',
    contactPhone: p.contactPhone ?? '',
    addressLine: p.addressLine ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    postalCode: p.postalCode ?? '',
    location: p.location,
    acceptsVeg: p.acceptsVeg,
    acceptsNonVeg: p.acceptsNonVeg,
    maxDailyCapacity: p.maxDailyCapacity,
    collectionRadiusKm: p.collectionRadiusKm,
    beneficiariesCount: p.beneficiariesCount,
    beneficiaryDescription: p.beneficiaryDescription ?? '',
    hasRefrigeration: p.hasRefrigeration,
    defaultVehicleCapacity: p.defaultVehicleCapacity,
  };
}

function toUpdate(v: Values): NgoProfileUpdate {
  // Omitted fields are unchanged server-side; empty optional text is omitted (it cannot be cleared to null).
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    organizationName: v.organizationName.trim(),
    registrationNumber: opt(v.registrationNumber),
    contactPhone: opt(v.contactPhone),
    addressLine: opt(v.addressLine),
    city: opt(v.city),
    state: opt(v.state),
    postalCode: opt(v.postalCode),
    ...(v.location ? { location: v.location } : {}),
    acceptsVeg: v.acceptsVeg,
    acceptsNonVeg: v.acceptsNonVeg,
    ...(v.maxDailyCapacity !== null ? { maxDailyCapacity: v.maxDailyCapacity } : {}),
    collectionRadiusKm: v.collectionRadiusKm,
    beneficiariesCount: v.beneficiariesCount,
    beneficiaryDescription: opt(v.beneficiaryDescription),
    hasRefrigeration: v.hasRefrigeration,
    defaultVehicleCapacity: v.defaultVehicleCapacity,
  };
}

/** Organisation details, location (India-wide), what the NGO accepts and its capacity. */
export function NgoDetailsCard({ profile }: { profile: NgoProfile }) {
  const update = useUpdateNgoProfile();
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
    try {
      const saved = await update.mutateAsync(toUpdate(v));
      reset(toValues(saved));
      void reloadUser();
      toast.success('Profile saved', 'Matching uses the new details from now on.');
    } catch (err) {
      setFormError(
        applyServerErrors(err, setError, {
          fields: FIELDS,
          fieldMap: { 'location.lat': 'location', 'location.lng': 'location', '': 'acceptsNonVeg' },
          codeMap: { LOCATION_OUTSIDE_INDIA: 'location' },
        }),
      );
    }
  });

  return (
    <Card>
      <CardHeader title="Organisation details" description={`Contact email: ${profile.contactEmail ?? '—'}`} icon={<Building2 className="size-4" aria-hidden="true" />} />
      <CardBody>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4 sm:grid-cols-2">
          {formError ? (
            <Banner tone="danger" live className="sm:col-span-2">
              {formError}
            </Banner>
          ) : null}
          <Field label="Organisation name" error={errors.organizationName?.message} required>
            <Input {...register('organizationName')} />
          </Field>
          <Field label="Registration number" error={errors.registrationNumber?.message} hint="Trust, society or Section 8 registration">
            <Input {...register('registrationNumber')} />
          </Field>
          <Field label="Contact phone" error={errors.contactPhone?.message} hint="International format, e.g. +919876543210">
            <Input type="tel" {...register('contactPhone')} />
          </Field>
          <Field label="Postal code" error={errors.postalCode?.message}>
            <Input {...register('postalCode')} />
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
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-200">NGO location</p>
            <Controller
              control={control}
              name="location"
              render={({ field }) => (
                <LocationPicker
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  label="NGO location"
                  allowClear={false}
                  emptyHint="No location set: donations cannot be matched to you until you set one."
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

          <FieldSet legend="Food you accept" error={errors.acceptsNonVeg?.message} className="sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox label="Vegetarian food" {...register('acceptsVeg')} />
              <Checkbox label="Non-vegetarian food" {...register('acceptsNonVeg')} />
            </div>
          </FieldSet>
          <Field label="Collection radius (km)" error={errors.collectionRadiusKm?.message} hint="How far your team can travel (max 100 km). Matching only suggests food within it." required>
            <Input type="number" inputMode="decimal" min={0.5} max={100} step={0.5} {...register('collectionRadiusKm', { valueAsNumber: true })} />
          </Field>
          <Field label="Maximum per day (units)" error={errors.maxDailyCapacity?.message} hint="What you can receive and distribute in a day">
            <Input type="number" inputMode="numeric" min={1} step={1} {...register('maxDailyCapacity', { setValueAs: numberOrNull })} />
          </Field>
          <Field label="People you serve" error={errors.beneficiariesCount?.message} required>
            <Input type="number" inputMode="numeric" min={0} step={1} {...register('beneficiariesCount', { valueAsNumber: true })} />
          </Field>
          <Field label="Default vehicle capacity (units)" error={errors.defaultVehicleCapacity?.message} hint="Used as the default for route planning; leave empty if it varies">
            <Input type="number" inputMode="numeric" min={1} step={1} {...register('defaultVehicleCapacity', { setValueAs: numberOrNull })} />
          </Field>
          <Field label="Who you serve" error={errors.beneficiaryDescription?.message} className="sm:col-span-2" hint="Shown to donors (max 1000 characters)">
            <Textarea {...register('beneficiaryDescription')} maxLength={1000} />
          </Field>
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="hasRefrigeration"
              render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="We have refrigeration" description="Lets matching suggest refrigerated or frozen food to you." />}
            />
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

/** Accepted food categories: a hard matching filter (PUT /ngos/me/food-preferences). */
export function FoodPreferencesCard({ selected }: { selected: string[] }) {
  const categories = useFoodCategories();
  const save = useSetFoodPreferences();
  const toast = useToast();
  const [value, setValue] = useState<string[]>(selected);
  const [dirty, setDirty] = useState(false);
  return (
    <Card id="food-preferences" className="scroll-mt-24">
      <CardHeader
        title="Food preferences"
        description="A matching filter: you are matched with, and can request, only donations in these categories."
        icon={<Filter className="size-4" aria-hidden="true" />}
      />
      <CardBody className="space-y-4">
        {categories.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : categories.isError ? (
          <ErrorState error={categories.error} compact onRetry={() => void categories.refetch()} />
        ) : (
          <fieldset>
            <legend className="sr-only">Accepted food categories</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.data.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  description={c.requiresRefrigeration ? `${c.description ?? ''} Needs refrigeration.`.trim() : (c.description ?? undefined)}
                  checked={value.includes(c.id)}
                  onChange={(e) => {
                    setDirty(true);
                    setValue((v) => (e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id)));
                  }}
                />
              ))}
            </div>
          </fieldset>
        )}
        {value.length === 0 ? <Banner tone="warning">With no category selected, no donation can be matched to you or requested.</Banner> : null}
        <Button
          disabled={!dirty}
          loading={save.isPending}
          onClick={() =>
            save.mutate(value, {
              onSuccess: () => {
                setDirty(false);
                toast.success('Food preferences saved', 'Recommendations are updated with the next matching run.');
              },
              onError: (e) => toast.error(e),
            })
          }
        >
          Save preferences
        </Button>
      </CardBody>
    </Card>
  );
}
