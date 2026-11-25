import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export function ProgressBar({ value, max, label, className, tone = 'brand' }: { value: number; max: number; label: string; className?: string; tone?: 'brand' | 'info' | 'warning' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colour = tone === 'info' ? 'bg-sky-400' : tone === 'warning' ? 'bg-amber-400' : 'bg-brand-500';
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn('h-2 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <div className={cn('h-full rounded-full transition-[width]', colour)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DescriptionList({ items, className, columns = 2 }: { items: { term: ReactNode; description: ReactNode; key?: string }[]; className?: string; columns?: 1 | 2 | 3 }) {
  const cols = columns === 1 ? '' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', cols, className)}>
      {items.map((item, i) => (
        <div key={item.key ?? i} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">{item.term}</dt>
          <dd className="mt-1 text-sm break-words text-slate-100">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, src, size = 'md', className }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const dims = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-base', xl: 'size-24 text-2xl' }[size];
  if (src) return <img src={src} alt={name} className={cn('shrink-0 rounded-full object-cover ring-1 ring-white/10', dims, className)} />;
  return (
    <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-full bg-brand-600/25 font-semibold text-brand-100 ring-1 ring-brand-400/20', dims, className)}>
      {initials || '?'}
    </span>
  );
}

export function SectionTitle({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">{children}</h2>
      {action}
    </div>
  );
}
