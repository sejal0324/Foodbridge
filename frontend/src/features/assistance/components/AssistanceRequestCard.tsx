import { CalendarClock, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, DistanceLabel, ProgressBar, StatusBadge } from '@/components/ui';
import type { AssistanceRequest, Urgency } from '@/types';
import { formatNumber, formatQuantity, formatWindow } from '@/utils/format';
import { DIETARY_LABELS, URGENCY_LABELS } from '@/utils/labels';
import { URGENCY_TONE } from '../urgency';

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return <Badge tone={URGENCY_TONE[urgency]}>{URGENCY_LABELS[urgency]} urgency</Badge>;
}

/** Summary card of an NGO assistance request (shared by donor and NGO areas). */
export function AssistanceRequestCard({ request, to, actions }: { request: AssistanceRequest; to: string; actions?: ReactNode }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              <Link to={to} className="hover:underline">
                {request.ngo.name} needs {formatQuantity(request.quantityRemaining, request.unit)}
              </Link>
            </h3>
            <UrgencyBadge urgency={request.urgency} />
            {request.status !== 'OPEN' ? <StatusBadge status={request.status} /> : null}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {request.category.name} · {DIETARY_LABELS[request.dietaryRequirement]}
          </p>
        </div>
        {request.distanceKm !== undefined ? <DistanceLabel km={request.distanceKm} source={request.distanceSource} /> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-4 text-slate-500" aria-hidden="true" />
          {formatWindow(request.neededFrom, request.neededUntil)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-4 text-slate-500" aria-hidden="true" />
          {formatNumber(request.beneficiariesCount)} people
        </span>
      </div>
      <div className="mt-3">
        <ProgressBar value={request.quantityCommitted} max={request.quantityRequired} label="Share of the requirement already committed" tone="info" />
        <p className="mt-1 text-xs text-slate-500">
          {formatNumber(request.quantityCommitted)} of {formatQuantity(request.quantityRequired, request.unit)} committed by donors
        </p>
      </div>
      {actions ? <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div> : null}
    </article>
  );
}
