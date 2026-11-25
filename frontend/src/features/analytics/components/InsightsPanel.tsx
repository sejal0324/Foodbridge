import { Lightbulb } from 'lucide-react';
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import type { InsightsResponse } from '@/types';
import { useInsights } from '../api';

const CONFIDENCE_TONE = { LOW: 'warning', MEDIUM: 'info', HIGH: 'success' } as const;

/** Rule-based insights with sample size, confidence and limitations (shared by all roles). */
export function InsightsPanel() {
  const query = useInsights();
  return (
    <Card>
      <CardHeader title="Insights" description="Patterns found in your data. Each insight states its sample size, confidence and limitations." icon={<Lightbulb className="size-4" aria-hidden="true" />} />
      <CardBody>
        {query.isPending ? <SkeletonList rows={2} /> : query.isError ? <ErrorState error={query.error} compact onRetry={() => void query.refetch()} /> : <InsightsBody data={query.data} />}
      </CardBody>
    </Card>
  );
}

export function InsightsBody({ data }: { data: InsightsResponse }) {
  if (data.status === 'UNAVAILABLE') {
    return (
      <Banner tone="warning" title="Insights unavailable">
        {data.message ?? 'Insights are unavailable while the AI service is offline.'}
      </Banner>
    );
  }
  return (
    <div className="space-y-4">
      {data.dataLabel !== 'REAL' ? <Banner tone="demo">These insights include demo or synthetic records, so they do not describe real-world performance.</Banner> : null}
      {data.insights.length === 0 ? (
        <EmptyState compact title="Not enough data for reliable insights yet" description="Insights appear only when there is a large enough sample. Keep recording donations and collections." />
      ) : (
        <ul className="space-y-3">
          {data.insights.map((i) => (
            <li key={`${i.type}-${i.title}`} className="rounded-xl border border-white/10 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{i.title}</p>
                <Badge tone={CONFIDENCE_TONE[i.confidence]}>{i.confidence.toLowerCase()} confidence</Badge>
                <Badge tone="neutral">n = {i.sampleSize}</Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{i.body}</p>
              {i.limitations.length > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-400">
                  {i.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.skipped.length > 0 ? (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer text-slate-300">Why some insights are missing ({data.skipped.length})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {data.skipped.map((s) => (
              <li key={s.type}>
                {s.type.replace(/_/g, ' ').toLowerCase()}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
