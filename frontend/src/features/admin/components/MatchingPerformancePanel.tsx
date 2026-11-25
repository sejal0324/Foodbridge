import { formatNumber } from '@/utils/format';
import type { MatchingPerformance } from '../types';

/** Matching run statistics (deterministic weighted ranking, not machine learning). */
export function MatchingPerformancePanel({ data }: { data: MatchingPerformance }) {
  const items = [
    { label: 'Matching runs', value: formatNumber(data.runs), hint: `${formatNumber(data.fallbackRuns)} used the distance-only fallback` },
    { label: 'Response rate', value: data.responseRate === null ? '—' : `${formatNumber(data.responseRate)}%`, hint: `${formatNumber(data.positiveResponses)} requested or offered of ${formatNumber(data.notified)} notified` },
    { label: 'Average score', value: data.averageScore === null ? '—' : `${formatNumber(Number(data.averageScore))} / 100`, hint: 'Eligible candidates only' },
    { label: 'Candidates', value: formatNumber(data.eligibleCandidates + data.ineligibleCandidates), hint: `${formatNumber(data.eligibleCandidates)} eligible · ${formatNumber(data.ineligibleCandidates)} ineligible` },
  ];
  return (
    <div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.label} className="rounded-xl border border-white/10 p-4">
            <dt className="text-sm text-slate-400">{i.label}</dt>
            <dd className="mt-1 text-xl font-semibold text-white tabular-nums">{i.value}</dd>
            <dd className="mt-0.5 text-xs text-slate-400">{i.hint}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        {formatNumber(data.negativeResponses)} declined or unavailable responses. Matching ranks eligible partners with configurable weights (see Settings); it is deterministic and does not learn from
        data.
      </p>
    </div>
  );
}
