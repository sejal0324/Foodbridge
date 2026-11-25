import { BrainCircuit, Cpu, Lightbulb, Scale, Target } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Banner, Card, CardBody, CardHeader, DataTable, DescriptionList, EmptyState, ErrorState, LoadingState, PageHeader, SkeletonList } from '@/components/ui';
import { InsightsBody, useInsights } from '@/features/analytics';
import { formatDateTime, formatNumber, formatPercent, humanize } from '@/utils/format';
import { useAiPerformance } from '../api';
import { MatchingPerformancePanel } from '../components/MatchingPerformancePanel';
import type { AiPerformance, ServiceModelInfo } from '../types';

export default function AiPerformancePage() {
  const query = useAiPerformance();
  return (
    <>
      <PageHeader title="AI performance" description="How the forecasting model, the matching engine and the insights are doing, with the limits of each stated plainly." />
      <div className="space-y-6">
        <Banner tone="info" icon={<Scale className="size-5 text-sky-300" aria-hidden="true" />} title="Matching is not machine learning">
          Partner matching is a deterministic weighted ranking: eligible donors or NGOs are scored on eight criteria using the weights in{' '}
          <Link to="/admin/settings" className="underline">
            Settings
          </Link>
          . The same inputs always give the same ranking, and every score comes with its explanation. Only surplus forecasting uses a trained model.
        </Banner>
        {query.isPending ? (
          <LoadingState label="Loading AI performance…" />
        ) : query.isError ? (
          <ErrorState error={query.error} title="AI performance could not be loaded" onRetry={() => void query.refetch()} />
        ) : (
          <Performance data={query.data} />
        )}
        <InsightsCard />
      </div>
    </>
  );
}

function Performance({ data }: { data: AiPerformance }) {
  const svc = data.service;
  const serviceModels = Object.entries(svc.models ?? {});
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="AI service" description="The internal service that serves forecasts, insights and the optimiser." icon={<Cpu className="size-4" aria-hidden="true" />} actions={<Badge tone={svc.status === 'ok' ? 'success' : 'danger'} dot>{svc.status === 'ok' ? 'Available' : 'Unavailable'}</Badge>} />
          <CardBody>
            {svc.status === 'ok' ? (
              <DescriptionList
                items={[
                  { term: 'Service', description: `${svc.service ?? 'foodbridge-ai'} ${svc.version ? `v${svc.version}` : ''}` },
                  { term: 'Assistant language model', description: svc.llm?.configured ? `Configured (${svc.llm.provider ?? 'provider'})` : 'Not configured: the assistant answers with direct tools and fallbacks only' },
                ]}
              />
            ) : (
              <Banner tone="warning">The AI service did not respond. Forecasts and insights are unavailable; matching falls back to distance-only ordering and says so to users.</Banner>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Live forecast accuracy" description="Stored forecasts compared with surplus donors later recorded." icon={<Target className="size-4" aria-hidden="true" />} />
          <CardBody className="space-y-3">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-slate-400">Sample size</dt>
                <dd className="mt-1 text-2xl font-semibold text-white tabular-nums">{formatNumber(data.liveForecastAccuracy.sampleSize)}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-400">Mean absolute error</dt>
                <dd className="mt-1 text-2xl font-semibold text-white tabular-nums">{data.liveForecastAccuracy.meanAbsoluteError === null ? '—' : `${formatNumber(data.liveForecastAccuracy.meanAbsoluteError)} units`}</dd>
              </div>
            </dl>
            {data.liveForecastAccuracy.sampleSize === 0 ? <Banner tone="info">No real comparisons yet, so live accuracy is unknown. It appears once donors record actual surplus for forecast days.</Banner> : null}
            {data.liveForecastAccuracy.sampleSize > 0 && data.liveForecastAccuracy.sampleSize < 30 ? <Banner tone="warning">Fewer than 30 comparisons: treat this error as a rough indication only.</Banner> : null}
            <p className="text-xs text-slate-400">{data.liveForecastAccuracy.note}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Forecasting model" description="Versions reported by the AI service and recorded by the backend." icon={<BrainCircuit className="size-4" aria-hidden="true" />} />
        <CardBody className="space-y-6">
          {serviceModels.length === 0 && data.models.length === 0 ? <EmptyState compact title="No model versions recorded" /> : null}
          {serviceModels.map(([name, info]) => (
            <ModelMetrics key={name} name={name} info={info} />
          ))}
          {data.models.length > 0 ? (
            <section aria-labelledby="model-versions">
              <h3 id="model-versions" className="mb-2 text-sm font-semibold text-white">
                Version history
              </h3>
              <DataTable
                caption="Model versions"
                rows={data.models}
                rowKey={(r) => `${r.modelName}-${r.version}`}
                columns={[
                  { key: 'name', header: 'Model', cell: (r) => humanize(r.modelName) },
                  { key: 'version', header: 'Version', cell: (r) => <span className="font-mono text-xs">{r.version}</span> },
                  { key: 'algo', header: 'Algorithm', cell: (r) => r.algorithm },
                  { key: 'label', header: 'Training data', cell: (r) => <TrainingLabel label={r.trainingDataLabel} /> },
                  { key: 'active', header: 'Active', cell: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge>Retired</Badge>) },
                  { key: 'seen', header: 'First seen', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.firstSeenAt)}</span>, hideOnMobile: true },
                ]}
              />
            </section>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Matching performance" description="Weighted-ranking runs and how notified partners responded." icon={<Scale className="size-4" aria-hidden="true" />} />
        <CardBody>
          <MatchingPerformancePanel data={data.matching} />
        </CardBody>
      </Card>
    </>
  );
}

function TrainingLabel({ label }: { label: string | undefined }) {
  if (!label) return <Badge>Unknown</Badge>;
  if (label === 'SYNTHETIC') return <Badge tone="warning">Synthetic training data</Badge>;
  if (label === 'MIXED') return <Badge tone="violet">Mixed (real + synthetic)</Badge>;
  return <Badge tone="success">Real data</Badge>;
}

const METRIC_ROWS: { key: string; baseline?: string; label: string; lowerIsBetter: boolean; percent?: boolean }[] = [
  { key: 'mae', baseline: 'baseline_mae', label: 'Mean absolute error (units)', lowerIsBetter: true },
  { key: 'rmse', baseline: 'baseline_rmse', label: 'Root mean squared error (units)', lowerIsBetter: true },
  { key: 'interval_coverage', label: 'Prediction-interval coverage', lowerIsBetter: false, percent: true },
];

function ModelMetrics({ name, info }: { name: string; info: ServiceModelInfo }) {
  const m = info.metrics ?? {};
  const num = (k: string | undefined) => (k && typeof m[k] === 'number' ? (m[k] as number) : null);
  const rows = METRIC_ROWS.filter((r) => num(r.key) !== null);
  return (
    <section aria-label={`${humanize(name)} metrics`} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{humanize(name)}</h3>
        <span className="font-mono text-xs text-slate-400">{info.version}</span>
        <Badge tone="neutral">{info.algorithm ?? 'Unknown algorithm'}</Badge>
        <TrainingLabel label={info.training_data_label} />
      </div>
      {info.training_data_label === 'SYNTHETIC' ? (
        <Banner tone="warning" title="Trained on synthetic data">
          This model was trained on generated data, not on real donor records. Its metrics describe performance on that synthetic test set and do not prove real-world accuracy; compare with the live accuracy above.
        </Banner>
      ) : null}
      {rows.length > 0 ? (
        <DataTable
          caption={`${humanize(name)} test metrics`}
          rows={rows}
          rowKey={(r) => r.key}
          columns={[
            { key: 'metric', header: 'Metric', cell: (r) => r.label },
            { key: 'model', header: 'Model', align: 'right', cell: (r) => (r.percent ? formatPercent(num(r.key), 1) : formatNumber(num(r.key))) },
            { key: 'baseline', header: 'Baseline', align: 'right', cell: (r) => (r.baseline && num(r.baseline) !== null ? formatNumber(num(r.baseline)) : '—') },
            {
              key: 'diff',
              header: 'vs baseline',
              align: 'right',
              cell: (r) => {
                const model = num(r.key);
                const base = num(r.baseline);
                if (model === null || base === null || base === 0) return '—';
                const better = r.lowerIsBetter ? model < base : model > base;
                const pct = Math.abs((model - base) / base);
                return <Badge tone={better ? 'success' : 'warning'}>{`${formatPercent(pct, 1)} ${better ? 'better' : 'worse'}`}</Badge>;
              },
            },
          ]}
        />
      ) : (
        <p className="text-sm text-slate-400">The service did not report metrics for this model.</p>
      )}
      <p className="text-xs text-slate-500">
        {typeof m.split === 'string' ? `Evaluated on the ${m.split} split. ` : ''}
        {info.trained_at ? `Trained ${formatDateTime(info.trained_at)}. ` : ''}The baseline is the same-weekday trailing average; the model is only kept if it beats it.
      </p>
    </section>
  );
}

function InsightsCard() {
  const query = useInsights();
  return (
    <Card>
      <CardHeader title="Platform insights" description="Rule-based patterns across all of India, each with its sample size, confidence and limitations." icon={<Lightbulb className="size-4" aria-hidden="true" />} />
      <CardBody>{query.isPending ? <SkeletonList rows={2} /> : query.isError ? <ErrorState error={query.error} compact onRetry={() => void query.refetch()} /> : <InsightsBody data={query.data} />}</CardBody>
    </Card>
  );
}
