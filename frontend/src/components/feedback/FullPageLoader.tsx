import { Spinner } from '@/components/ui';

export function FullPageLoader({ label = 'Loading FoodBridge…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center gap-3 text-sm text-slate-400">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
