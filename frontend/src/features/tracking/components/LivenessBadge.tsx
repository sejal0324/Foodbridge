import { Badge } from '@/components/ui';
import type { Liveness } from '@/types';
import { formatAge } from '../liveness';

/** LIVE only for fresh positions; STALE always says how old the data is. */
export function LivenessBadge({ liveness, ageSeconds }: { liveness: Liveness; ageSeconds: number | null }) {
  switch (liveness) {
    case 'LIVE':
      return (
        <Badge tone="success" icon={<span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}>
          <span data-liveness="LIVE">Live</span>
        </Badge>
      );
    case 'STALE':
      return (
        <Badge tone="warning" dot>
          <span data-liveness="STALE">Stale · last updated {ageSeconds !== null ? `${formatAge(ageSeconds)} ago` : 'a while ago'}</span>
        </Badge>
      );
    case 'WAITING_FOR_FIRST_POSITION':
      return (
        <Badge tone="info" dot>
          <span data-liveness="WAITING">Waiting for first position</span>
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral" dot>
          <span data-liveness="ENDED">Tracking ended</span>
        </Badge>
      );
  }
}
