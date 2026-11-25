import type { DonationHistoryEntry } from '@/types';
import { StatusBadge } from '@/components/ui';
import { formatDateTime } from '@/utils/format';

/** Chronological status history (from donation_status_history). */
export function StatusTimeline({ history }: { history: DonationHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-sm text-slate-400">No status changes recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-white/10 pl-5">
      {history.map((h, i) => (
        <li key={`${h.at}-${i}`} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-canvas bg-brand-400" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={h.to} />
            <time dateTime={h.at} className="text-xs text-slate-500">
              {formatDateTime(h.at)}
            </time>
          </div>
          {h.reason ? <p className="mt-1 text-sm text-slate-400 first-letter:uppercase">{h.reason}</p> : null}
        </li>
      ))}
    </ol>
  );
}
