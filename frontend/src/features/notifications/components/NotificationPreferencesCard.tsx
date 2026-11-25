import { zodResolver } from '@hookform/resolvers/zod';
import { BellRing, MonitorSmartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, Skeleton, Switch, useToast } from '@/components/ui';
import type { NotificationPreferences } from '@/types';
import { applyServerErrors } from '@/utils/formErrors';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '../api';
import { browserNotificationPermission, requestBrowserNotificationPermission } from '../browserNotifications';

const time = z.union([z.literal(''), z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM')]);
const schema = z
  .object({
    emailEnabled: z.boolean(),
    maxPerHour: z.number({ error: 'Enter a number' }).int().min(1, 'At least 1').max(100, 'At most 100'),
    maxDistanceKm: z.union([z.nan(), z.number().positive('Must be positive').max(100, 'At most 100 km')]),
    quietHoursStart: time,
    quietHoursEnd: time,
  })
  .refine((v) => (v.quietHoursStart === '') === (v.quietHoursEnd === ''), { path: ['quietHoursEnd'], message: 'Set both start and end, or neither' });
type Values = z.infer<typeof schema>;

const toValues = (p: NotificationPreferences): Values => ({
  emailEnabled: p.emailEnabled,
  maxPerHour: p.maxPerHour,
  maxDistanceKm: p.maxDistanceKm ?? Number.NaN,
  quietHoursStart: p.quietHoursStart ?? '',
  quietHoursEnd: p.quietHoursEnd ?? '',
});

/** GET/PUT /notifications/preferences, plus optional desktop alerts. */
export function NotificationPreferencesCard() {
  const query = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [permission, setPermission] = useState(browserNotificationPermission());
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (query.data) reset(toValues(query.data));
  }, [query.data, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const saved = await update.mutateAsync({
        emailEnabled: v.emailEnabled,
        maxPerHour: v.maxPerHour,
        maxDistanceKm: Number.isNaN(v.maxDistanceKm) ? null : v.maxDistanceKm,
        quietHoursStart: v.quietHoursStart || null,
        quietHoursEnd: v.quietHoursEnd || null,
      });
      reset(toValues(saved));
      toast.success('Preferences saved');
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['emailEnabled', 'maxPerHour', 'maxDistanceKm', 'quietHoursStart', 'quietHoursEnd'] }));
    }
  });

  return (
    <Card>
      <CardHeader title="Notification preferences" icon={<BellRing className="size-4" aria-hidden="true" />} />
      <CardBody>
        {query.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} compact onRetry={() => void query.refetch()} />
        ) : (
          <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
            {formError ? (
              <Banner tone="danger" live>
                {formError}
              </Banner>
            ) : null}
            {!query.data.emailDeliveryAvailable ? (
              <Banner tone="warning" title="Email delivery is not configured">
                This FoodBridge environment cannot send emails right now. In-app notifications still work; your email preference is saved for later.
              </Banner>
            ) : null}
            <Controller
              control={control}
              name="emailEnabled"
              render={({ field }) => (
                <Switch
                  checked={Boolean(field.value)}
                  onChange={field.onChange}
                  label="Email copies of important notifications"
                  description={query.data.emailDeliveryAvailable ? 'Requests, reservations and handover updates.' : 'Saved, but not delivered until email is configured.'}
                />
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Maximum alerts per hour" error={errors.maxPerHour?.message} hint="Low-priority match alerts beyond this are skipped" required>
                <Input type="number" min={1} max={100} step={1} {...register('maxPerHour', { valueAsNumber: true })} />
              </Field>
              <Field label="Only alert me within (km)" error={errors.maxDistanceKm?.message} hint="Leave empty for no limit">
                <Input type="number" min={1} max={100} step="any" {...register('maxDistanceKm', { valueAsNumber: true })} />
              </Field>
              <Field label="Quiet hours start" error={errors.quietHoursStart?.message} hint="IST, 24-hour">
                <Input type="time" {...register('quietHoursStart')} />
              </Field>
              <Field label="Quiet hours end" error={errors.quietHoursEnd?.message}>
                <Input type="time" {...register('quietHoursEnd')} />
              </Field>
            </div>
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save preferences
            </Button>
          </form>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
          <div className="flex items-start gap-3">
            <MonitorSmartphone className="mt-0.5 size-5 text-slate-400" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-white">Desktop alerts</p>
              <p className="text-xs text-slate-400">
                {permission === 'granted'
                  ? 'On: you get a system alert for new notifications while FoodBridge is in a background tab.'
                  : permission === 'denied'
                    ? 'Blocked in your browser settings.'
                    : permission === 'unsupported'
                      ? 'Not supported by this browser.'
                      : 'Get a system alert for new notifications while FoodBridge is in a background tab.'}
              </p>
            </div>
          </div>
          {permission === 'default' ? (
            <Button size="sm" variant="outline" onClick={async () => setPermission(await requestBrowserNotificationPermission())}>
              Enable desktop alerts
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
