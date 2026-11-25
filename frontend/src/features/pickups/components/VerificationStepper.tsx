import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';
import { VERIFICATION_STEPS, type VerificationStep } from '../verification';

export function VerificationStepper({ current }: { current: VerificationStep }) {
  const index = VERIFICATION_STEPS.findIndex((s) => s.step === current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Verification progress">
      {VERIFICATION_STEPS.map((s, i) => {
        const done = index > i;
        const active = index === i;
        return (
          <li key={s.step} className="flex shrink-0 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'grid size-7 place-items-center rounded-full text-xs font-semibold',
                done ? 'bg-brand-600 text-white' : active ? 'border-2 border-brand-400 text-brand-200' : 'border border-white/15 text-slate-500',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn('text-xs font-medium', active ? 'text-white' : done ? 'text-slate-300' : 'text-slate-500')}>
              {s.label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {i < VERIFICATION_STEPS.length - 1 ? <span className="h-px w-6 bg-white/15" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
