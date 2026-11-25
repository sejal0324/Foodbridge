import { Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Countdown, DistanceLabel, QuantityBadge, StatusBadge } from '@/components/ui';
import type { Donation } from '@/types';
import { formatWindow } from '@/utils/format';
import { DIETARY_LABELS, STORAGE_LABELS } from '@/utils/labels';

const OPEN = ['AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED'];

/**
 * Summary card of a donation (shared: donor lists, the NGO marketplace).
 * `to` links the title; `actions` renders buttons such as "Request food".
 */
export function DonationCard({ donation: d, to, actions, showDonor }: { donation: Donation; to: string; actions?: ReactNode; showDonor?: boolean }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              <Link to={to} className="hover:underline">
                {d.foodName}
              </Link>
            </h3>
            <StatusBadge status={d.status} />
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {showDonor ? `${d.donor.name} · ` : ''}
            {d.category.name} · {DIETARY_LABELS[d.dietaryType]} · {STORAGE_LABELS[d.storageType]}
          </p>
        </div>
        <QuantityBadge quantity={d.availableQuantity} unit={d.unit} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4 text-slate-500" aria-hidden="true" />
          {formatWindow(d.pickupAvailableFrom, d.pickupDeadline)}
        </span>
        {OPEN.includes(d.status) ? <Countdown to={d.pickupDeadline} /> : null}
        {d.distanceKm !== undefined ? <DistanceLabel km={d.distanceKm} source={d.distanceSource} /> : null}
      </div>
      {actions ? <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div> : null}
    </article>
  );
}
