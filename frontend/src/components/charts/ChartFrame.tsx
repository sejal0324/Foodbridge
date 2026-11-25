import { BarChart3, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, DataTable, type Column } from '@/components/ui';

export interface LegendItem {
  label: string;
  colour: string;
  /** 'band' renders a translucent swatch (e.g. a forecast range). */
  kind?: 'line' | 'bar' | 'band';
}

export interface ChartFrameProps<Row> {
  title: string;
  description?: ReactNode;
  legend?: LegendItem[];
  /** Accessible table view of the same data. */
  table: { columns: Column<Row>[]; rows: Row[]; rowKey: (r: Row) => string };
  children: ReactNode;
  height?: number;
  actions?: ReactNode;
}

/**
 * Chart container: title, legend (for ≥2 series), and a chart/table toggle so
 * the numbers are always available without relying on colour or hover.
 */
export function ChartFrame<Row>({ title, description, legend, table, children, height = 260, actions }: ChartFrameProps<Row>) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section aria-label={title} className="rounded-2xl border border-white/10 bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-slate-400">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
            leftIcon={view === 'chart' ? <Table2 className="size-4" aria-hidden="true" /> : <BarChart3 className="size-4" aria-hidden="true" />}
            aria-pressed={view === 'table'}
          >
            {view === 'chart' ? 'Table' : 'Chart'}
          </Button>
        </div>
      </div>
      {legend && legend.length > 1 && view === 'chart' ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={l.kind === 'line' ? 'h-0.5 w-4 rounded' : 'size-2.5 rounded-sm'}
                style={{ background: l.colour, opacity: l.kind === 'band' ? 0.35 : 1 }}
              />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4">
        {view === 'chart' ? (
          <div style={{ height }} aria-hidden="true">
            {children}
          </div>
        ) : (
          <DataTable columns={table.columns} rows={table.rows} rowKey={table.rowKey} caption={`${title} (table)`} />
        )}
      </div>
    </section>
  );
}
