import { Clock } from 'lucide-react';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/format';
import { remainingLabel } from './countdown-utils';

/** Live countdown to a deadline (amber under an hour, red when passed). */
export function Countdown({ to, endedLabel = 'Deadline passed', className, showIcon = true }: { to: string; endedLabel?: string; className?: string; showIcon?: boolean }) {
  const now = useNow(30_000);
  const target = new Date(to).getTime();
  const diff = target - now;
  const tone = diff <= 0 ? 'text-red-300' : diff < 3_600_000 ? 'text-amber-300' : 'text-slate-300';
  return (
    <time dateTime={to} title={formatDateTime(to)} className={cn('inline-flex items-center gap-1 text-xs font-medium tabular-nums', tone, className)}>
      {showIcon ? <Clock className="size-3.5" aria-hidden="true" /> : null}
      {remainingLabel(target, now, endedLabel)}
    </time>
  );
}
