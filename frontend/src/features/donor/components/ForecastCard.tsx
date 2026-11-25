import { Info, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Banner, Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui';
import type { SurplusForecast } from '@/types';
import { formatShortDate } from '@/utils/format';
import { MEAL_PERIOD_LABELS } from '@/utils/labels';

export function ModelLabel({ forecast }: { forecast: SurplusForecast }) {
  if (!forecast.model) return null;
  return (
    <Badge tone={forecast.model.trainingDataLabel === 'REAL' ? 'neutral' : 'violet'} title={`${forecast.model.algorithm} · ${forecast.model.version}`}>
      {forecast.model.trainingDataLabel === 'REAL' ? 'Model trained on real data' : `Model trained on ${forecast.model.trainingDataLabel.toLowerCase()} data`}
    </Badge>
  );
}

/**
 * Surplus forecast summary. Shows UNAVAILABLE and INSUFFICIENT_HISTORY
 * honestly, the training-data label, and that a forecast is not a donation.
 */
export function ForecastCard({ query, action }: { query: { data?: SurplusForecast; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; action?: ReactNode }) {
  const f = query.data;
  return (
    <Card>
      <CardHeader title="Surplus forecast" description="Estimated surplus meals for today and tomorrow" icon={<TrendingUp className="size-4" aria-hidden="true" />} actions={f ? <ModelLabel forecast={f} /> : null} />
      <CardBody className="space-y-4">
        {query.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} compact onRetry={() => void query.refetch()} />
        ) : f?.status === 'UNAVAILABLE' ? (
          <Banner tone="warning" title="Forecast unavailable">
            {f.message ?? 'The forecasting service is offline. Everything else keeps working.'}
          </Banner>
        ) : f ? (
          <>
            <ul className="grid gap-3 sm:grid-cols-2">
              {f.predictions.map((p) => (
                <li key={`${p.date}-${p.mealPeriod}`} className="rounded-xl border border-white/10 p-3">
                  <p className="text-xs text-slate-400">
                    {formatShortDate(p.date)} · {MEAL_PERIOD_LABELS[p.mealPeriod]}
                  </p>
                  {p.status === 'OK' && p.predictedQuantity !== null ? (
                    <>
                      <p className="mt-1 text-xl font-semibold text-white tabular-nums">
                        ~{p.predictedQuantity} <span className="text-sm font-normal text-slate-400">meals</span>
                      </p>
                      {p.lowerBound !== null && p.upperBound !== null ? (
                        <p className="text-xs text-slate-500">
                          likely range {p.lowerBound}–{p.upperBound}
                          {p.basis === 'baseline' ? ' · simple baseline' : ''}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-amber-300">Not enough history for this period</p>
                  )}
                </li>
              ))}
            </ul>
            {f.predictions.some((p) => p.status === 'INSUFFICIENT_HISTORY') && f.minHistoryDays ? (
              <p className="text-xs text-slate-400">
                Forecasts need at least {f.minHistoryDays} days of records; you have {f.historyDays}. Add daily records on the forecast page.
              </p>
            ) : null}
            <p className="flex gap-2 text-xs leading-relaxed text-slate-400">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {f.notice ?? 'A forecast is an estimate, not a donation. Only food you confirm can be offered or listed.'}
            </p>
          </>
        ) : null}
        {action}
      </CardBody>
    </Card>
  );
}
