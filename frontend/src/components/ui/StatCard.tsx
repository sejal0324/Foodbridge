import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { Skeleton } from './States';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, hint, icon, loading, className }: StatCardProps) {
  return (
    <div className={cn('rounded-2xl border border-white/10 bg-surface p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-400">{label}</p>
        {icon ? <div className="text-slate-500">{icon}</div> : null}
      </div>
      {loading ? <Skeleton className="mt-3 h-8 w-24" /> : <p className="mt-2 text-2xl font-semibold tracking-tight text-white tabular-nums">{value}</p>}
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
