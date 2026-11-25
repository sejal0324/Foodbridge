import { Package } from 'lucide-react';
import type { Unit } from '@/types';
import { cn } from '@/utils/cn';
import { formatQuantity } from '@/utils/format';

/** "40 meals" pill. Units are always shown with correct singular/plural. */
export function QuantityBadge({ quantity, unit, className, muted }: { quantity: number; unit: Unit | string; className?: string; muted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-medium tabular-nums', muted ? 'bg-white/5 text-slate-300' : 'bg-brand-600/15 text-brand-100', className)}>
      <Package className="size-3.5 opacity-80" aria-hidden="true" />
      {formatQuantity(quantity, unit)}
    </span>
  );
}
