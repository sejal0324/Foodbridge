import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART, FORECAST_COLOURS } from './theme';

export interface ForecastPoint {
  /** Category label on the x axis (e.g. "3 Nov"). */
  label: string;
  /** Recorded surplus (history). */
  actual?: number | null;
  /** Model estimate. */
  predicted?: number | null;
  /** [lower, upper] approximate range around the estimate. */
  range?: [number, number] | null;
}

/** Recorded history (line) followed by the forecast (line + translucent range band). */
export function ForecastChart({ data, unitLabel }: { data: ForecastPoint[]; unitLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: CHART.fontSize }} axisLine={{ stroke: CHART.axisLine }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={{ fill: CHART.axis, fontSize: CHART.fontSize }} axisLine={false} tickLine={false} allowDecimals={false} width={48} />
        <Tooltip
          cursor={{ stroke: CHART.axisLine }}
          content={(p) => (
            <ChartTooltip
              active={p.active}
              label={p.label as string}
              payload={p.payload as never}
              valueFormatter={(v) => (Array.isArray(v) ? `${v[0]}–${v[1]} ${unitLabel}` : v === null || v === undefined ? '—' : `${String(v)} ${unitLabel}`)}
            />
          )}
        />
        <Area type="monotone" dataKey="range" name="Forecast range" stroke="none" fill={FORECAST_COLOURS.predicted} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="actual" name="Recorded surplus" stroke={FORECAST_COLOURS.actual} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} isAnimationActive={false} connectNulls />
        <Line
          type="monotone"
          dataKey="predicted"
          name="Forecast"
          stroke={FORECAST_COLOURS.predicted}
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, stroke: CHART.surface, fill: FORECAST_COLOURS.predicted }}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
