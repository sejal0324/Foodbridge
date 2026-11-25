import { AlertOctagon, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/services/apiError';
import { cn } from '@/utils/cn';
import { Button } from './Button';
import { Spinner } from './Spinner';

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      <div className="grid size-12 place-items-center rounded-full bg-white/5 text-slate-400">{icon ?? <Inbox className="size-6" aria-hidden="true" />}</div>
      <div className="max-w-md">
        <p className="text-sm font-semibold text-white">{title}</p>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Error panel that shows the backend message and the requestId for support. */
export function ErrorState({ error, title = 'Something went wrong', onRetry, className, compact }: { error: unknown; title?: ReactNode; onRetry?: () => void; className?: string; compact?: boolean }) {
  const e = ApiError.from(error);
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12', className)}>
      <div className="grid size-12 place-items-center rounded-full bg-red-400/10 text-red-300">
        <AlertOctagon className="size-6" aria-hidden="true" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-slate-300">{e.message}</p>
        {e.requestId ? (
          <p className="mt-2 font-mono text-xs text-slate-500">
            Request ID: <span className="select-all">{e.requestId}</span>
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-white/[0.06]', className)} />;
}

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center gap-3 py-12 text-sm text-slate-400', className)}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border border-white/5 p-4">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}
