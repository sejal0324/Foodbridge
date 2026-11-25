import { Leaf } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/utils/cn';

export function Logo({ to = '/', compact, className }: { to?: string; compact?: boolean; className?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-400', className)} aria-label="FoodBridge AI home">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white shadow-sm shadow-black/30">
        <Leaf className="size-4.5" aria-hidden="true" />
      </span>
      {compact ? null : (
        <span className="text-[15px] font-semibold tracking-tight text-white">
          FoodBridge <span className="text-brand-300">AI</span>
        </span>
      )}
    </Link>
  );
}
