import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardPlus, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ChartFrame, FORECAST_COLOURS, ForecastChart, type ForecastPoint } from '@/components/charts';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, PageHeader, Select, StatCard, useToast } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { MEAL_PERIODS, type DailyMetric, type MealPeriod, type SurplusForecast } from '@/types';
import { formatDate, formatShortDate, todayIst } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { MEAL_PERIOD_LABELS } from '@/utils/labels';
import { useDailyMetrics, useForecastAccuracy, useRecordMetric, useSurplusForecast } from '../api';
import { ForecastCard } from '../components/ForecastCard';

const metricSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
    mealPeriod: z.enum(MEAL_PERIODS),
    preparedQty: z.number({ error: 'Enter a number' }).int('Whole numbers only').min(0).max(100000),
    soldQty: z.number({ error: 'Enter a number' }).int('Whole numbers only').min(0).max(100000),
    surplusQty: z.number({ error: 'Enter a number' }).int('Whole numbers only').min(0).max(100000),
    isHoliday: z.boolean(),
    specialEvent: z.string().trim().max(120),
  })
  .refine((m) => m.soldQty <= m.preparedQty, { path: ['soldQty'], message: 'Cannot exceed the prepared quantity' })
  .refine((m) => m.surplusQty <= m.preparedQty, { path: ['surplusQty'], message: 'Cannot exceed the prepared quantity' });
type MetricValues = z.infer<typeof metricSchema>;

export default function ForecastPage() {
  const user = useCurrentUser();
  const approved = isOrganisationApproved(user);
  const forecast = useSurplusForecast(approved);
  const metrics = useDailyMetrics(60);
  return (
    <>
      <PageHeader title="Forecast & records" description="Record what you prepare, sell and have left over each day; the forecast learns from your own history." />
      <div className="space-y-6">
        {approved ? <ForecastCard query={forecast} /> : <Banner tone="info">Forecasts are available once your organisation is verified. You can already review your records.</Banner>}
        {approved && forecast.data && metrics.data ? <ForecastChartSection forecast={forecast.data} metrics={metrics.data} /> : null}
        <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
          {approved ? <MetricForm /> : null}
          <MetricsTable query={metrics} />
        </div>
        <AccuracyCard />
      </div>
    </>
  );
}

function ForecastChartSection({ forecast, metrics }: { forecast: SurplusForecast; metrics: DailyMetric[] }) {
  const periods = useMemo(() => Array.from(new Set([...forecast.predictions.map((p) => p.mealPeriod), ...metrics.map((m) => m.mealPeriod)])), [forecast, metrics]);
  const [period, setPeriod] = useState<MealPeriod>(periods.includes('DINNER') ? 'DINNER' : (periods[0] ?? 'LUNCH'));
  const data: ForecastPoint[] = useMemo(() => {
    const history = metrics
      .filter((m) => m.mealPeriod === period)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
      .map((m) => ({ key: m.date, label: formatShortDate(m.date), actual: m.surplusQty, predicted: null, range: null }));
    const lastHistoryDate = history.at(-1)?.key ?? '';
    const future = forecast.predictions
      .filter((p) => p.mealPeriod === period && p.status === 'OK' && p.predictedQuantity !== null && p.date > lastHistoryDate)
      .map((p) => ({ key: p.date, label: formatShortDate(p.date), actual: null, predicted: p.predictedQuantity, range: p.lowerBound !== null && p.upperBound !== null ? ([p.lowerBound, p.upperBound] as [number, number]) : null }));
    // Join the forecast line to the last recorded point so the two read as one series in time.
    if (history.length > 0 && future.length > 0) {
      const last = history[history.length - 1] as (typeof history)[number];
      history[history.length - 1] = { ...last, predicted: last.actual } as never;
    }
    return [...history, ...future];
  }, [forecast, metrics, period]);

  if (forecast.status !== 'OK' || data.length === 0) return null;
  return (
    <ChartFrame
      title={`${MEAL_PERIOD_LABELS[period]} surplus: history and forecast`}
      description="Recorded surplus for the last 30 days, then the model estimate with its approximate 10th–90th percentile range."
      legend={[
        { label: 'Recorded surplus', colour: FORECAST_COLOURS.actual, kind: 'line' },
        { label: 'Forecast', colour: FORECAST_COLOURS.predicted, kind: 'line' },
        { label: 'Forecast range', colour: FORECAST_COLOURS.predicted, kind: 'band' },
      ]}
      actions={
        <Field label="Meal period" hideLabel className="w-36">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as MealPeriod)} options={periods.map((p) => ({ value: p, label: MEAL_PERIOD_LABELS[p] }))} />
        </Field>
      }
      table={{
        rows: data,
        rowKey: (r) => r.label,
        columns: [
          { key: 'date', header: 'Date', cell: (r) => r.label },
          { key: 'actual', header: 'Recorded', align: 'right', cell: (r) => r.actual ?? '—' },
          { key: 'pred', header: 'Forecast', align: 'right', cell: (r) => (r.actual === null ? (r.predicted ?? '—') : '—') },
          { key: 'range', header: 'Range', align: 'right', cell: (r) => (r.range ? `${r.range[0]}–${r.range[1]}` : '—') },
        ],
      }}
      height={280}
    >
      <ForecastChart data={data} unitLabel="meals" />
    </ChartFrame>
  );
}

function MetricForm() {
  const record = useRecordMetric();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MetricValues>({
    resolver: zodResolver(metricSchema),
    defaultValues: { date: todayIst(), mealPeriod: 'LUNCH', preparedQty: Number.NaN, soldQty: Number.NaN, surplusQty: Number.NaN, isHoliday: false, specialEvent: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await record.mutateAsync({ ...v, specialEvent: v.specialEvent || undefined });
      toast.success('Record saved', `${MEAL_PERIOD_LABELS[v.mealPeriod]} on ${formatDate(v.date)}`);
      reset({ ...v, preparedQty: Number.NaN, soldQty: Number.NaN, surplusQty: Number.NaN, specialEvent: '' });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['date', 'mealPeriod', 'preparedQty', 'soldQty', 'surplusQty', 'isHoliday', 'specialEvent'] }));
    }
  });
  return (
    <Card>
      <CardHeader title="Add a daily record" description="Saving the same date and meal period again updates it." icon={<ClipboardPlus className="size-4" aria-hidden="true" />} />
      <CardBody>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4 sm:grid-cols-2">
          {formError ? (
            <Banner tone="danger" live className="sm:col-span-2">
              {formError}
            </Banner>
          ) : null}
          <Field label="Date" error={errors.date?.message} required>
            <Input type="date" max={todayIst()} {...register('date')} />
          </Field>
          <Field label="Meal period" error={errors.mealPeriod?.message} required>
            <Select {...register('mealPeriod')} options={MEAL_PERIODS.map((m) => ({ value: m, label: MEAL_PERIOD_LABELS[m] }))} />
          </Field>
          <Field label="Prepared (meals)" error={errors.preparedQty?.message} required>
            <Input type="number" inputMode="numeric" min={0} step={1} {...register('preparedQty', { valueAsNumber: true })} />
          </Field>
          <Field label="Sold (meals)" error={errors.soldQty?.message} required>
            <Input type="number" inputMode="numeric" min={0} step={1} {...register('soldQty', { valueAsNumber: true })} />
          </Field>
          <Field label="Surplus (meals)" error={errors.surplusQty?.message} required>
            <Input type="number" inputMode="numeric" min={0} step={1} {...register('surplusQty', { valueAsNumber: true })} />
          </Field>
          <Field label="Special event" error={errors.specialEvent?.message} hint="Optional, e.g. a wedding booking">
            <Input {...register('specialEvent')} />
          </Field>
          <Checkbox className="sm:col-span-2" label="Public holiday" {...register('isHoliday')} />
          <div className="sm:col-span-2">
            <Button type="submit" loading={isSubmitting}>
              Save record
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function MetricsTable({ query }: { query: ReturnType<typeof useDailyMetrics> }) {
  return (
    <Card>
      <CardHeader title="Recent records" description="Last 60 days. Records marked Synthetic are demo data, not your real history." />
      <CardBody className="max-h-[560px] overflow-y-auto">
        <QueryState query={query} empty={<EmptyState compact title="No records yet" description="Add your first daily record to start building a forecast history." />}>
          {(rows) => (
            <DataTable
              caption="Daily records"
              rows={rows}
              rowKey={(r) => `${r.date}-${r.mealPeriod}`}
              columns={[
                { key: 'date', header: 'Date', cell: (r) => formatDate(r.date) },
                { key: 'period', header: 'Period', cell: (r) => MEAL_PERIOD_LABELS[r.mealPeriod] },
                { key: 'prep', header: 'Prepared', align: 'right', cell: (r) => r.preparedQty },
                { key: 'sold', header: 'Sold', align: 'right', cell: (r) => r.soldQty },
                { key: 'surplus', header: 'Surplus', align: 'right', cell: (r) => r.surplusQty },
                {
                  key: 'src',
                  header: 'Source',
                  cell: (r) => (r.dataSource === 'SYNTHETIC' ? <Badge tone="violet">Synthetic</Badge> : <Badge tone="neutral">{r.dataSource === 'REAL' ? 'Real' : r.dataSource}</Badge>),
                },
              ]}
            />
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function AccuracyCard() {
  const query = useForecastAccuracy();
  return (
    <Card>
      <CardHeader title="Forecast accuracy" description="Past forecasts compared with the surplus you later recorded." icon={<Target className="size-4" aria-hidden="true" />} />
      <CardBody>
        <QueryState query={query}>
          {(a) =>
            a.sampleSize === 0 ? (
              <EmptyState compact title="No comparisons yet" description="Accuracy appears once you record the actual surplus for a day that was forecast." />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <StatCard label="Mean absolute error" value={a.meanAbsoluteError !== null ? `${a.meanAbsoluteError} meals` : '—'} hint="Average gap between forecast and actual" />
                  <StatCard label="Comparisons" value={a.sampleSize} hint={a.sampleSize < 14 ? 'Small sample: treat with caution' : undefined} />
                </div>
                <DataTable
                  caption="Forecast vs actual"
                  rows={a.comparisons}
                  rowKey={(r) => `${r.date}-${r.mealPeriod}`}
                  columns={[
                    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date) },
                    { key: 'period', header: 'Period', cell: (r) => MEAL_PERIOD_LABELS[r.mealPeriod] },
                    { key: 'pred', header: 'Forecast', align: 'right', cell: (r) => r.predicted },
                    { key: 'act', header: 'Actual', align: 'right', cell: (r) => r.actual },
                    { key: 'err', header: 'Error', align: 'right', cell: (r) => r.predicted - r.actual },
                  ]}
                />
              </div>
            )
          }
        </QueryState>
      </CardBody>
    </Card>
  );
}
