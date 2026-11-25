import { IndianRupee } from 'lucide-react';
import type { FeeEstimate } from '@/types';
import { cn } from '@/utils/cn';
import { formatINR, formatQuantity } from '@/utils/format';

/** Renders a fee estimate returned by the API (e.g. after a request or an offer acceptance). */
export function FeeBreakdown({ fee, title = 'Service fee estimate', className }: { fee: FeeEstimate; title?: string; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/[0.02] p-4', className)}>
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        <IndianRupee className="size-4 text-brand-300" aria-hidden="true" /> {title}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-slate-400">
          {formatQuantity(fee.quantity, fee.unit)} × {formatINR(fee.unitAmount)}
        </dt>
        <dd className="text-right text-slate-200 tabular-nums">{formatINR(fee.baseAmount)}</dd>
        <dt className="text-slate-400">{fee.tax.applied ? `${fee.tax.name ?? 'Tax'} (${fee.tax.ratePercent}%)` : 'Tax'}</dt>
        <dd className="text-right text-slate-200 tabular-nums">{fee.tax.applied ? formatINR(fee.tax.amount) : 'Not applied'}</dd>
        <dt className="border-t border-white/10 pt-1 font-medium text-white">{fee.isEstimate ? 'Estimated total' : 'Total'}</dt>
        <dd className="border-t border-white/10 pt-1 text-right font-semibold text-white tabular-nums">{formatINR(fee.totalAmount)}</dd>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">{fee.note}</p>
    </div>
  );
}
