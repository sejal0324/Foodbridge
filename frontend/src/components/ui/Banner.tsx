import { AlertTriangle, CheckCircle2, Database, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'demo';

const styles: Record<BannerTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-sky-400/25 bg-sky-400/[0.07] text-sky-100', icon: <Info className="size-5 text-sky-300" aria-hidden="true" /> },
  warning: { box: 'border-amber-400/30 bg-amber-400/[0.08] text-amber-50', icon: <AlertTriangle className="size-5 text-amber-300" aria-hidden="true" /> },
  danger: { box: 'border-red-400/30 bg-red-400/[0.08] text-red-50', icon: <XCircle className="size-5 text-red-300" aria-hidden="true" /> },
  success: { box: 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-50', icon: <CheckCircle2 className="size-5 text-emerald-300" aria-hidden="true" /> },
  demo: { box: 'border-violet-400/25 bg-violet-400/[0.07] text-violet-50', icon: <Database className="size-5 text-violet-300" aria-hidden="true" /> },
};

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  icon?: ReactNode;
  /** Use role="alert" for errors the user must notice immediately. */
  live?: boolean;
}

/** Inline message block: info, warning, danger, success, or a "demo data" notice. */
export function Banner({ tone = 'info', title, children, actions, className, icon, live }: BannerProps) {
  const s = styles[tone];
  return (
    <div role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined} className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', s.box, className)}>
      <div className="mt-0.5 shrink-0">{icon ?? s.icon}</div>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn('leading-relaxed opacity-90', title ? 'mt-0.5' : undefined)}>{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
