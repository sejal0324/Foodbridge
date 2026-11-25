import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, Card, CardBody, CardHeader, Input, useToast } from '@/components/ui';
import type { AvailabilitySlot } from '@/types';
import { ISO_DAY_LABELS } from '@/utils/labels';
import { useSetAvailability } from '../api';

interface DraftSlot extends AvailabilitySlot {
  key: number;
}

let seq = 0;
const withKeys = (slots: AvailabilitySlot[]): DraftSlot[] => slots.map((s) => ({ ...s, key: ++seq }));
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Opening hours (PUT /donors/me/availability). Overnight windows are split into two slots. */
export function AvailabilityCard({ availability }: { availability: AvailabilitySlot[] }) {
  const [slots, setSlots] = useState<DraftSlot[]>(() => withKeys(availability));
  const [dirty, setDirty] = useState(false);
  const save = useSetAvailability();
  const toast = useToast();
  const invalid = slots.filter((s) => !TIME.test(s.opensAt) || !TIME.test(s.closesAt) || s.closesAt <= s.opensAt);

  const change = (next: DraftSlot[]) => {
    setSlots(next);
    setDirty(true);
  };

  return (
    <Card>
      <CardHeader title="Opening hours" description="Used to match NGO requests to times you can hand over food (IST)." icon={<CalendarClock className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-white/5">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const daySlots = slots.filter((s) => s.isoDayOfWeek === day);
            return (
              <li key={day} className="flex flex-wrap items-start gap-3 py-3">
                <p className="w-28 pt-2 text-sm font-medium text-slate-200">{ISO_DAY_LABELS[day]}</p>
                <div className="flex flex-1 flex-col gap-2">
                  {daySlots.length === 0 ? <p className="pt-2 text-sm text-slate-500">Closed</p> : null}
                  {daySlots.map((s) => {
                    const bad = invalid.includes(s);
                    return (
                      <div key={s.key} className="flex flex-wrap items-center gap-2">
                        <Input
                          type="time"
                          value={s.opensAt}
                          aria-label={`${ISO_DAY_LABELS[day]} opens at`}
                          aria-invalid={bad || undefined}
                          className="w-32"
                          onChange={(e) => change(slots.map((x) => (x.key === s.key ? { ...x, opensAt: e.target.value } : x)))}
                        />
                        <span className="text-slate-500">to</span>
                        <Input
                          type="time"
                          value={s.closesAt}
                          aria-label={`${ISO_DAY_LABELS[day]} closes at`}
                          aria-invalid={bad || undefined}
                          className="w-32"
                          onChange={(e) => change(slots.map((x) => (x.key === s.key ? { ...x, closesAt: e.target.value } : x)))}
                        />
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${ISO_DAY_LABELS[day]} ${s.opensAt}–${s.closesAt}`} onClick={() => change(slots.filter((x) => x.key !== s.key))}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={slots.length >= 28}
                  leftIcon={<Plus className="size-4" aria-hidden="true" />}
                  onClick={() => change([...slots, { key: ++seq, isoDayOfWeek: day, opensAt: '10:00', closesAt: '22:00' }])}
                >
                  Add hours
                </Button>
              </li>
            );
          })}
        </ul>
        {invalid.length > 0 ? <Banner tone="warning">Each closing time must be after its opening time. Split overnight hours into two slots (e.g. 18:00–23:59 and 00:00–02:00 next day).</Banner> : null}
        <Button
          disabled={!dirty || invalid.length > 0}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              slots.map(({ isoDayOfWeek, opensAt, closesAt }) => ({ isoDayOfWeek, opensAt, closesAt })),
              {
                onSuccess: () => {
                  setDirty(false);
                  toast.success('Opening hours saved');
                },
                onError: (e) => toast.error(e),
              },
            )
          }
        >
          Save opening hours
        </Button>
      </CardBody>
    </Card>
  );
}
