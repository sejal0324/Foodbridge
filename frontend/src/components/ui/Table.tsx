import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Right-align numbers. */
  align?: 'left' | 'right';
  /** Omit from the mobile card layout. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption?: string;
  /** Title line of each mobile card. When set it replaces the first column on mobile; defaults to the first column. */
  mobileTitle?: (row: T) => ReactNode;
  className?: string;
}

/**
 * Responsive table: a real <table> from the md breakpoint, stacked cards on
 * small screens (each card lists "header: value" pairs).
 */
export function DataTable<T>({ columns, rows, rowKey, caption, mobileTitle, className }: DataTableProps<T>) {
  const [first, ...rest] = columns;
  return (
    <div className={className}>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-white/10 text-xs tracking-wide text-slate-400 uppercase">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-3 font-medium', c.align === 'right' && 'text-right', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-white/[0.02]">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle text-slate-200', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 text-sm font-medium text-white">{mobileTitle ? mobileTitle(row) : first?.cell(row)}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {rest
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-slate-400">{c.header}</dt>
                    <dd className="min-w-0 text-right text-slate-200">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
