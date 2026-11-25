import { PauseCircle } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, Card, CardBody, CardHeader, Field, Input, Switch, useToast } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import type { DonorProfile } from '@/types';
import { formatDateTime, fromIstInputValue, istInputToMillis, toIstInputValue } from '@/utils/format';
import { useUpdateDonorProfile } from '../api';

/** Pause availability ("unavailable until…") and opt in/out of NGO requests. */
export function AvailabilitySettingsCard({ profile }: { profile: DonorProfile }) {
  const update = useUpdateDonorProfile();
  const toast = useToast();
  const now = useNow(30_000);
  const [until, setUntil] = useState(() => toIstInputValue(new Date(now + 24 * 3_600_000)));
  const paused = profile.pausedUntil !== null && Date.parse(profile.pausedUntil) > now;
  const untilValid = istInputToMillis(until) > now;
  return (
    <Card>
      <CardHeader title="Availability" icon={<PauseCircle className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-6">
        <Switch
          checked={profile.acceptsAssistanceRequests}
          disabled={update.isPending}
          onChange={(v) =>
            update.mutate({ acceptsAssistanceRequests: v }, { onSuccess: () => toast.success(v ? 'You will receive NGO requests' : 'NGO requests turned off'), onError: (e) => toast.error(e) })
          }
          label="Accept NGO requests"
          description="When on, NGOs’ food requirements that match your usual food are recommended to you."
        />
        <div className="space-y-3 border-t border-white/10 pt-5">
          <p className="text-sm font-medium text-white">Pause availability</p>
          {paused ? (
            <Banner
              tone="warning"
              title={`Paused until ${formatDateTime(profile.pausedUntil)}`}
              actions={
                <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => update.mutate({ pausedUntil: null }, { onSuccess: () => toast.success('Availability resumed'), onError: (e) => toast.error(e) })}>
                  Resume now
                </Button>
              }
            >
              You are not matched to NGO requests while paused. Your existing donations and pickups continue.
            </Banner>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Mark me unavailable until (IST)" error={untilValid ? undefined : 'Choose a time in the future'} className="w-64">
                <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
              <Button
                variant="outline"
                disabled={!untilValid}
                loading={update.isPending}
                onClick={() => update.mutate({ pausedUntil: fromIstInputValue(until) }, { onSuccess: () => toast.success('Availability paused'), onError: (e) => toast.error(e) })}
              >
                Pause
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
