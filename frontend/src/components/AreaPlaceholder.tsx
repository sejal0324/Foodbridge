import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/ui';

/** Temporary page for role areas that are not built yet. */
export function AreaPlaceholder({ area }: { area: string }) {
  return (
    <>
      <PageHeader title={`${area} area`} />
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-white/5 text-slate-400">
          <Hammer className="size-6" aria-hidden="true" />
        </div>
        <p className="text-base font-semibold text-white">This area is being built</p>
        <p className="max-w-md text-sm text-slate-400">The {area.toLowerCase()} pages are coming in the next release. Your account and notifications already work.</p>
      </div>
    </>
  );
}
