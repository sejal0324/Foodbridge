import type { CriteriaBreakdown as Criteria } from '@/types';
import { cn } from '@/utils/cn';
import { humanize } from '@/utils/format';
import { CRITERION_LABELS } from '../criteria';

/**
 * Per-criterion explanation of a weighted match score: each criterion's score
 * (0–100), its weight, and how many points it contributed to the total.
 */
export function CriteriaBreakdown({ criteria, className }: { criteria: Criteria; className?: string }) {
  const rows = Object.entries(criteria).sort((a, b) => b[1].weight - a[1].weight || b[1].contribution - a[1].contribution);
  const totalWeight = rows.reduce((s, [, c]) => s + c.weight, 0) || 100;
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Score breakdown by criterion</caption>
        <thead>
          <tr className="text-xs text-slate-400">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Criterion
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Score
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Weight
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Points
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(([key, c]) => (
            <tr key={key} className="align-top">
              <th scope="row" className="py-2 pr-3 font-normal">
                <span className="block text-slate-200">{CRITERION_LABELS[key] ?? humanize(key)}</span>
                <span className="block text-xs text-slate-500">{c.detail}</span>
              </th>
              <td className="w-[32%] py-2 pr-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                    <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }} />
                  </div>
                  <span className="w-9 text-right text-xs text-slate-300 tabular-nums">{Math.round(c.score)}</span>
                </div>
              </td>
              <td className="py-2 pr-3 text-right text-xs text-slate-400 tabular-nums">{Math.round((c.weight / totalWeight) * 100)}%</td>
              <td className="py-2 text-right text-xs font-medium text-slate-200 tabular-nums">{c.contribution.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
