import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '@/utils/format';
import { Button } from './Button';

export function Pagination({ page, pageSize, total, onPageChange, className }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return null;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <p>
          Showing <span className="text-slate-200">{formatNumber(from)}</span>–<span className="text-slate-200">{formatNumber(to)}</span> of{' '}
          <span className="text-slate-200">{formatNumber(total)}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} leftIcon={<ChevronLeft className="size-4" aria-hidden="true" />}>
            Previous
          </Button>
          <span aria-current="page" className="px-1 tabular-nums">
            {page} / {pages}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} rightIcon={<ChevronRight className="size-4" aria-hidden="true" />}>
            Next
          </Button>
        </div>
      </div>
    </nav>
  );
}
