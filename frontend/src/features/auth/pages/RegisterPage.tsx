import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, HeartHandshake } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { fillEmptyAddressFields, LocationPicker } from '@/components/map';
import { Banner, Button, Field, FieldSet, Input, Select, StateSelect } from '@/components/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AuthCard } from '@/layouts/AuthLayout';
import { BUSINESS_TYPES } from '@/types';
import { cn } from '@/utils/cn';
import { applyServerErrors } from '@/utils/formErrors';
import { BUSINESS_TYPE_LABELS } from '@/utils/labels';
import { homePathFor, useAuth } from '../auth-context';
import { PasswordInput, PasswordPolicy } from '../components/PasswordInput';
import { REGISTER_FIELD_MAP, registerFormSchema, toRegisterInput, type RegisterFormValues } from '../schemas';

const FIELDS = [
  'accountType',
  'fullName',
  'email',
  'phone',
  'password',
  'confirmPassword',
  'organizationName',
  'businessType',
  'licenseNumber',
  'registrationNumber',
  'addressLine',
  'city',
  'state',
  'postalCode',
  'location',
] as const;

export default function RegisterPage() {
  useDocumentTitle('Create an account');
  const [params] = useSearchParams();
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const initialType = params.get('type') === 'NGO' ? 'NGO' : 'DONOR';

  const {
    register,
    control,
    handleSubmit,
    setError,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      accountType: initialType,
      fullName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      organizationName: '',
      businessType: 'RESTAURANT',
      licenseNumber: '',
      registrationNumber: '',
      addressLine: '',
      city: '',
      state: '',
      postalCode: '',
      location: null,
    },
  });
  const accountType = useWatch({ control, name: 'accountType' });
  const password = useWatch({ control, name: 'password' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await signUp(toRegisterInput(values));
      navigate(homePathFor(user), { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fieldMap: REGISTER_FIELD_MAP, fields: FIELDS, codeMap: { EMAIL_TAKEN: 'email', LOCATION_OUTSIDE_INDIA: 'location' } }));
    }
  });

  return (
    <AuthCard wide title="Create your FoodBridge account" description="Registration is free for food businesses and NGOs across India. FoodBridge verifies every organisation before it can list or collect food.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}

        <FieldSet legend="I am registering…" error={errors.accountType?.message}>
          <Controller
            control={control}
            name="accountType"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Account type" className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    { value: 'DONOR', title: 'A food donor', body: 'Restaurant, hotel, caterer or food business with surplus food. Always free.', icon: Building2 },
                    { value: 'NGO', title: 'An NGO', body: 'Verified organisation collecting food for people in need. ₹5 per successfully redistributed unit.', icon: HeartHandshake },
                  ] as const
                ).map((o) => {
                  const checked = field.value === o.value;
                  const Icon = o.icon;
                  return (
                    <label
                      key={o.value}
                      className={cn(
                        'flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors focus-within:outline-2 focus-within:outline-brand-400',
                        checked ? 'border-brand-400/60 bg-brand-600/10' : 'border-white/10 hover:border-white/20',
                      )}
                    >
                      <input type="radio" name={field.name} value={o.value} checked={checked} onChange={() => field.onChange(o.value)} className="sr-only" />
                      <Icon className={cn('mt-0.5 size-5 shrink-0', checked ? 'text-brand-300' : 'text-slate-500')} aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold text-white">{o.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{o.body}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          />
        </FieldSet>

        <section aria-labelledby="reg-you" className="grid gap-4 sm:grid-cols-2">
          <h2 id="reg-you" className="text-sm font-semibold tracking-wide text-slate-300 uppercase sm:col-span-2">
            Your details
          </h2>
          <Field label="Full name" error={errors.fullName?.message} required>
            <Input autoComplete="name" {...register('fullName')} />
          </Field>
          <Field label="Phone" error={errors.phone?.message} hint="International format, e.g. +919876543210">
            <Input type="tel" autoComplete="tel" placeholder="+91…" {...register('phone')} />
          </Field>
          <Field label="Email" error={errors.email?.message} required className="sm:col-span-2">
            <Input type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Password" error={errors.password?.message} required>
            <PasswordInput autoComplete="new-password" {...register('password')} />
          </Field>
          <Field label="Confirm password" error={errors.confirmPassword?.message} required>
            <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
          </Field>
          <div className="sm:col-span-2">
            <PasswordPolicy value={password ?? ''} />
          </div>
        </section>

        <section aria-labelledby="reg-org" className="grid gap-4 sm:grid-cols-2">
          <h2 id="reg-org" className="text-sm font-semibold tracking-wide text-slate-300 uppercase sm:col-span-2">
            {accountType === 'DONOR' ? 'Business details' : 'NGO details'}
          </h2>
          <Field label={accountType === 'DONOR' ? 'Business name' : 'NGO name'} error={errors.organizationName?.message} required className="sm:col-span-2">
            <Input autoComplete="organization" {...register('organizationName')} />
          </Field>
          {accountType === 'DONOR' ? (
            <>
              <Field label="Business type" error={errors.businessType?.message} required>
                <Select {...register('businessType')} options={BUSINESS_TYPES.map((b) => ({ value: b, label: BUSINESS_TYPE_LABELS[b] }))} />
              </Field>
              <Field label="Licence number (FSSAI or trade)" error={errors.licenseNumber?.message} hint="Optional now; needed for verification.">
                <Input {...register('licenseNumber')} />
              </Field>
            </>
          ) : (
            <Field label="Registration number" error={errors.registrationNumber?.message} hint="Optional now; needed for verification." className="sm:col-span-2">
              <Input {...register('registrationNumber')} />
            </Field>
          )}
          <Field label="Address" error={errors.addressLine?.message} className="sm:col-span-2">
            <Input autoComplete="street-address" {...register('addressLine')} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input autoComplete="address-level2" {...register('city')} />
          </Field>
          <Field label="State / union territory" error={errors.state?.message}>
            <StateSelect autoComplete="address-level1" {...register('state')} />
          </Field>
          <Field label="Postal code" error={errors.postalCode?.message}>
            <Input autoComplete="postal-code" inputMode="numeric" {...register('postalCode')} />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-200">Location on the map (optional)</p>
            <p className="mb-3 text-xs text-slate-400">
              Used for matching nearby {accountType === 'DONOR' ? 'NGOs' : 'donors'} anywhere in India. Search for your address, use your current location or click the map; you can also set it
              later in your profile.
            </p>
            <Controller
              control={control}
              name="location"
              render={({ field }) => (
                <LocationPicker
                  value={field.value}
                  onChange={field.onChange}
                  label="Organisation location"
                  emptyHint="No location selected yet."
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
        </section>

        <div className="flex flex-col gap-3">
          <Button type="submit" loading={isSubmitting} size="lg" fullWidth>
            Create account
          </Button>
          <p className="text-center text-sm text-slate-400">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-brand-300 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </AuthCard>
  );
}
