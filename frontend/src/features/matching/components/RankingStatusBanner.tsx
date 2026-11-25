import { Banner } from '@/components/ui';
import type { RankingStatus } from '@/types';

/** Explains the overall state of a recommendation run. */
export function RankingStatusBanner({ status, candidateNoun = 'NGOs' }: { status: RankingStatus | string; candidateNoun?: string }) {
  if (status === 'RANKING_UNAVAILABLE') {
    return (
      <Banner tone="warning" title="AI ranking unavailable — ordered by distance">
        The matching service could not score candidates, so eligible {candidateNoun} are listed by straight-line distance only. Review them before acting.
      </Banner>
    );
  }
  if (status === 'NO_ELIGIBLE_CANDIDATES') {
    return (
      <Banner tone="info" title={`No eligible ${candidateNoun} right now`}>
        Every nearby candidate is ineligible for at least one reason listed below (for example capacity, dietary preference or distance). Refreshing later may find new matches.
      </Banner>
    );
  }
  if (status === 'NOT_RUN') {
    return (
      <Banner tone="info" title="Matching has not run yet">
        Matching runs automatically after publishing. Use “Refresh matches” to run it now.
      </Banner>
    );
  }
  return null;
}
