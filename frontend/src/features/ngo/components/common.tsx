import { ArrowRight, Check, Circle, CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ProgressBar } from '@/components/ui';
import type { AssistanceRequest } from '@/types';
import { cn } from '@/utils/cn';
import { formatNumber, formatQuantity } from '@/utils/format';

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:underline">
      {children} <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

/** Committed (by donors), received (delivered to the NGO) against the required quantity. */
export function AssistanceProgress({ request: r, compact }: { request: Pick<AssistanceRequest, 'quantityRequired' | 'quantityCommitted' | 'quantityReceived' | 'quantityRemaining' | 'unit'>; compact?: boolean }) {
  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      <div>
        <ProgressBar value={r.quantityCommitted} max={r.quantityRequired} label="Committed by donors" tone="info" />
        <p className="mt-1 text-xs text-slate-400">
          <span className="text-slate-200">{formatNumber(r.quantityCommitted)}</span> of {formatQuantity(r.quantityRequired, r.unit)} committed
          {r.quantityRemaining > 0 ? ` · ${formatQuantity(r.quantityRemaining, r.unit)} still needed` : ' · fully covered'}
        </p>
      </div>
      <div>
        <ProgressBar value={r.quantityReceived} max={r.quantityRequired} label="Received" />
        <p className="mt-1 text-xs text-slate-400">
          <span className="text-slate-200">{formatNumber(r.quantityReceived)}</span> received (delivery confirmed)
        </p>
      </div>
    </div>
  );
}

const OFFER_STEPS = ['PROPOSED', 'ACCEPTED', 'RESERVED', 'PICKUP_ASSIGNED', 'COMPLETED'] as const;
const OFFER_STEP_LABELS: Record<(typeof OFFER_STEPS)[number], string> = {
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  RESERVED: 'Reserved',
  PICKUP_ASSIGNED: 'Pickup assigned',
  COMPLETED: 'Completed',
};

/** PROPOSED → ACCEPTED → RESERVED → PICKUP_ASSIGNED → COMPLETED, or the terminal state it stopped at. */
export function OfferTimeline({ status }: { status: string }) {
  const index = OFFER_STEPS.indexOf(status as (typeof OFFER_STEPS)[number]);
  const stopped = index === -1;
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Offer progress">
      {OFFER_STEPS.map((step, i) => {
        const done = !stopped && i < index;
        const current = !stopped && i === index;
        return (
          <li key={step} className="flex items-center gap-1.5" aria-current={current ? 'step' : undefined}>
            {done ? (
              <Check className="size-3.5 text-brand-300" aria-hidden="true" />
            ) : (
              <Circle className={cn('size-3', current ? 'fill-current text-brand-300' : 'text-slate-600')} aria-hidden="true" />
            )}
            <span className={cn('text-xs', current ? 'font-semibold text-white' : done ? 'text-slate-300' : 'text-slate-500')}>
              {OFFER_STEP_LABELS[step]}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {i < OFFER_STEPS.length - 1 ? <span className="h-px w-3 bg-white/15" aria-hidden="true" /> : null}
          </li>
        );
      })}
      {stopped ? (
        <li className="flex items-center gap-1 text-xs font-semibold text-red-300">
          <CircleX className="size-3.5" aria-hidden="true" /> {status.charAt(0) + status.slice(1).toLowerCase()}
        </li>
      ) : null}
    </ol>
  );
}
