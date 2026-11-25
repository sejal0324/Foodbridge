import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART, SERIES_COLOURS } from './theme';

export interface BarSeries {
  key: string;
  label: string;
  colour?: string;
}

export interface SimpleBarChartProps<Row extends Record<string, unknown>> {
  data: Row[];
  xKey: string;
  series: BarSeries[];
  xFormatter?: (value: string) => string;
  valueFormatter?: (value: number) => string;
  layout?: 'vertical' | 'horizontal';
}

/** Bars from one baseline (≤24px thick, 4px rounded data end). One axis only. */
export function SimpleBarChart<Row extends Record<string, unknown>>({ data, xKey, series, xFormatter, valueFormatter, layout = 'horizontal' }: SimpleBarChartProps<Row>) {
  const horizontalBars = layout === 'vertical';
  const fmt = (v: unknown) => (valueFormatter && typeof v === 'number' ? valueFormatter(v) : String(v));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, bottom: 0, left: horizontalBars ? 8 : -8 }} barGap={2}>
        <CartesianGrid stroke={CHART.grid} vertical={horizontalBars} horizontal={!horizontalBars} />
        {horizontalBars ? (
          <>
            <XAxis type="number" tick={{ fill: CHART.axis, fontSize: CHART.fontSize }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => fmt(v)} />
            <YAxis type="category" dataKey={xKey} width={120} tick={{ fill: CHART.axis, fontSize: CHART.fontSize }} axisLine={{ stroke: CHART.axisLine }} tickLine={false} tickFormatter={xFormatter} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fill: CHART.axis, fontSize: CHART.fontSize }} axisLine={{ stroke: CHART.axisLine }} tickLine={false} tickFormatter={xFormatter} interval="preserveStartEnd" />
            <YAxis tick={{ fill: CHART.axis, fontSize: CHART.fontSize }} axisLine={false} tickLine={false} allowDecimals={false} width={48} tickFormatter={(v: number) => fmt(v)} />
          </>
        )}
        <Tooltip
          cursor={{ fill: CHART.cursor }}
          content={(p) => <ChartTooltip active={p.active} label={p.label as string} payload={p.payload as never} labelFormatter={(l) => (xFormatter ? xFormatter(String(l)) : String(l))} valueFormatter={(v) => fmt(v)} />}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.colour ?? SERIES_COLOURS[i % SERIES_COLOURS.length]}
            maxBarSize={CHART.barMaxSize}
            radius={horizontalBars ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
