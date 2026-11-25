import { ChevronDown, CircleSlash, Info } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge, DistanceLabel } from '@/components/ui';
import type { CriteriaBreakdown as Criteria, DistanceSource } from '@/types';
import { cn } from '@/utils/cn';
import { CriteriaBreakdown } from './CriteriaBreakdown';

export interface RecommendationCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  score: number | null;
  rank?: number | null;
  eligible?: boolean;
  explanation?: string | null;
  limitations?: string[] | null;
  criteria?: Criteria | null;
  ineligibilityReasons?: { code: string; text: string }[];
  distanceKm?: number | null;
  distanceSource?: DistanceSource | string | null;
  /** e.g. NOT_RANKED / RANKING_UNAVAILABLE for this item. */
  rankingStatus?: string;
  response?: string;
  actions?: ReactNode;
  className?: string;
}

/**
 * One explainable match: score, plain-language explanation, limitations,
 * ineligibility reasons and an expandable per-criterion breakdown. Used for
 * NGO recommendations (donor side) and donor recommendations (NGO side).
 */
export function RecommendationCard({
  title,
  subtitle,
  score,
  rank,
  eligible = true,
  explanation,
  limitations,
  criteria,
  ineligibilityReasons = [],
  distanceKm,
  distanceSource,
  rankingStatus,
  response,
  actions,
  className,
}: RecommendationCardProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <article className={cn('rounded-xl border p-4', eligible ? 'border-white/10 bg-white/[0.02]' : 'border-white/5 bg-transparent opacity-80', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rank ? <span className="text-xs font-semibold text-slate-500 tabular-nums">#{rank}</span> : null}
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {!eligible ? (
              <Badge tone="neutral" icon={<CircleSlash className="size-3" aria-hidden="true" />}>
                Not eligible
              </Badge>
            ) : null}
            {rankingStatus === 'RANKING_UNAVAILABLE' ? <Badge tone="warning">Distance order</Badge> : null}
            {response && response !== 'NONE' ? <Badge tone="info">{response.charAt(0) + response.slice(1).toLowerCase()}</Badge> : null}
          </div>
          {subtitle ? <div className="mt-1 text-sm text-slate-400">{subtitle}</div> : null}
          <div className="mt-1.5">
            <DistanceLabel km={distanceKm} source={distanceSource} />
          </div>
        </div>
        {score !== null && score !== undefined ? (
          <div className="text-right">
            <p className="text-2xl font-semibold text-white tabular-nums">{Math.round(score)}</p>
            <p className="text-xs text-slate-500">match score / 100</p>
          </div>
        ) : null}
      </div>

      {explanation ? <p className="mt-3 text-sm leading-relaxed text-slate-300">{explanation}</p> : null}

      {!eligible && ineligibilityReasons.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Why this candidate is not eligible">
          {ineligibilityReasons.map((r) => (
            <li key={r.code}>
              <Badge tone="neutral">{r.text}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {limitations && limitations.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-slate-400">
          {limitations.map((l) => (
            <li key={l} className="flex gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              {l}
            </li>
          ))}
        </ul>
      ) : null}

      {(criteria || actions) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {criteria ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={panelId}
              className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand-300 hover:underline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
              {open ? 'Hide score breakdown' : 'Why this score?'}
            </button>
          ) : (
            <span />
          )}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      )}
      {criteria && open ? (
        <div id={panelId} className="mt-3 rounded-lg border border-white/5 bg-black/10 p-3">
          <CriteriaBreakdown criteria={criteria} />
        </div>
      ) : null}
    </article>
  );
}
