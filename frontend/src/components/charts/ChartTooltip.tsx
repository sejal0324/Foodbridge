import type { ReactNode } from 'react';

interface TooltipEntry {
  name?: ReactNode;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: ReactNode;
  payload?: readonly TooltipEntry[];
  labelFormatter?: (label: unknown) => ReactNode;
  valueFormatter?: (value: unknown, entry: TooltipEntry) => ReactNode;
}

/** Shared tooltip: text in text colours, a coloured swatch carries identity. */
export function ChartTooltip({ active, label, payload, labelFormatter, valueFormatter }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-xs shadow-xl shadow-black/40">
      {label !== undefined ? <p className="mb-1 font-medium text-white">{labelFormatter ? labelFormatter(label) : label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2 text-slate-300">
            <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            <span>{p.name}</span>
            <span className="ml-auto pl-3 font-medium text-white tabular-nums">{valueFormatter ? valueFormatter(p.value, p) : String(p.value ?? '—')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
