/**
 * Chart parameters for the dark surface (#111a2c). Categorical slots were
 * validated with the dataviz palette validator (dark mode): lightness band,
 * chroma floor, CVD separation (worst adjacent ΔE 9.4) and ≥3:1 contrast pass.
 * Assign slots in this fixed order; never cycle or generate extra hues.
 */
export const SERIES_COLOURS = ['#3987e5', '#d95926', '#199e70'] as const;

export const CHART = {
  grid: 'rgba(255,255,255,0.07)',
  axis: '#94a3b8',
  axisLine: 'rgba(255,255,255,0.12)',
  surface: '#111a2c',
  cursor: 'rgba(255,255,255,0.06)',
  fontSize: 12,
  barMaxSize: 24,
} as const;

/** Forecast chart: recorded history vs model estimate (slots 1 and 2). */
export const FORECAST_COLOURS = { actual: SERIES_COLOURS[0], predicted: SERIES_COLOURS[1] } as const;
