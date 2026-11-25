import { IndianRupee } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import type { Unit } from '@/types';
import { cn } from '@/utils/cn';
import { formatINR, formatQuantity } from '@/utils/format';
import { useFeeEstimate } from '../api';

/**
 * NGO service-fee estimate (base, tax, total) with the backend's note. Shown
 * wherever an NGO commits to a quantity. Donors are never charged.
 */
export function FeeEstimateCard({ unit, quantity, className }: { unit: Unit; quantity: number; className?: string }) {
  const q = useFeeEstimate(unit, quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/[0.02] p-4', className)}>
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        <IndianRupee className="size-4 text-brand-300" aria-hidden="true" /> Service fee estimate
      </p>
      {q.isPending ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : q.isError ? (
        <p className="mt-2 text-sm text-amber-300">The fee estimate is unavailable right now.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-400">
              {formatQuantity(q.data.quantity, q.data.unit)} × {formatINR(q.data.unitAmount)}
            </dt>
            <dd className="text-right text-slate-200 tabular-nums">{formatINR(q.data.baseAmount)}</dd>
            <dt className="text-slate-400">{q.data.tax.applied ? `${q.data.tax.name ?? 'Tax'} (${q.data.tax.ratePercent}%)` : 'Tax'}</dt>
            <dd className="text-right text-slate-200 tabular-nums">{q.data.tax.applied ? formatINR(q.data.tax.amount) : 'Not applied'}</dd>
            <dt className="border-t border-white/10 pt-1 font-medium text-white">Estimated total</dt>
            <dd className="border-t border-white/10 pt-1 text-right font-semibold text-white tabular-nums">{formatINR(q.data.totalAmount)}</dd>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">{q.data.note}</p>
        </>
      )}
    </div>
  );
}
