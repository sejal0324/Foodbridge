import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'violet';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-slate-400/10 text-slate-300 ring-slate-400/25',
  success: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  warning: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  danger: 'bg-red-400/10 text-red-300 ring-red-400/30',
  info: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
  brand: 'bg-brand-500/15 text-brand-200 ring-brand-400/30',
  violet: 'bg-violet-400/10 text-violet-300 ring-violet-400/25',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  dot?: boolean;
  title?: string;
}

export function Badge({ tone = 'neutral', children, className, icon, dot, title }: BadgeProps) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {icon}
      {children}
    </span>
  );
}
