import { RefreshCw, Scale } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, SkeletonList, useToast } from '@/components/ui';
import { RankingStatusBanner, RecommendationCard, useNgoRecommendations, useRefreshMatches } from '@/features/matching';
import type { DonationDetail } from '@/types';
import { formatRelative } from '@/utils/format';

/** Ranked, explained NGO recommendations for an open donation. */
export function RecommendedNgosPanel({ donation }: { donation: DonationDetail }) {
  const open = ['AVAILABLE', 'PARTIALLY_RESERVED'].includes(donation.status);
  const query = useNgoRecommendations(donation.id, donation.status !== 'DRAFT');
  const refresh = useRefreshMatches();
  const toast = useToast();
  const [showIneligible, setShowIneligible] = useState(false);
  const items = query.data?.items ?? [];
  const eligible = items.filter((i) => i.eligible);
  const ineligible = items.filter((i) => !i.eligible);
  const ranAt = items[0]?.createdAt;

  return (
    <Card>
      <CardHeader
        title="Recommended NGOs"
        description={ranAt ? `Weighted matching (${items[0]?.algorithmVersion ?? 'weighted'}) · last run ${formatRelative(ranAt)}` : 'Explainable, weighted matching of nearby verified NGOs.'}
        icon={<Scale className="size-4" aria-hidden="true" />}
        actions={
          open ? (
            <Button
              size="sm"
              variant="outline"
              loading={refresh.isPending}
              leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}
              onClick={() =>
                refresh.mutate(
                  { donationId: donation.id },
                  { onSuccess: () => toast.success('Matches refreshed'), onError: (e) => toast.error(e) },
                )
              }
            >
              Refresh matches
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {donation.status === 'DRAFT' ? (
          <EmptyState compact title="Publish to find NGOs" description="Matching runs when the donation is published." />
        ) : query.isPending ? (
          <SkeletonList rows={2} />
        ) : query.isError ? (
          <ErrorState error={query.error} compact onRetry={() => void query.refetch()} />
        ) : (
          <>
            <RankingStatusBanner status={query.data.rankingStatus} />
            {eligible.length > 0 ? (
              <div className="space-y-3">
                {eligible.map((r) => (
                  <RecommendationCard
                    key={r.candidate.id}
                    title={r.candidate.name}
                    score={r.score}
                    rank={r.rank}
                    eligible
                    explanation={r.explanation}
                    limitations={r.limitations}
                    criteria={r.criteria}
                    distanceKm={r.distanceKm}
                    distanceSource={r.distanceSource}
                    rankingStatus={r.rankingStatus}
                    response={r.response}
                    subtitle={r.notifiedAt ? `Notified ${formatRelative(r.notifiedAt)}` : undefined}
                  />
                ))}
              </div>
            ) : null}
            {ineligible.length > 0 ? (
              <div>
                <Button variant="link" onClick={() => setShowIneligible((s) => !s)} aria-expanded={showIneligible}>
                  {showIneligible ? 'Hide' : 'Show'} {ineligible.length} ineligible NGO{ineligible.length === 1 ? '' : 's'} and why
                </Button>
                {showIneligible ? (
                  <div className="mt-3 space-y-3">
                    {ineligible.map((r) => (
                      <RecommendationCard
                        key={r.candidate.id}
                        title={r.candidate.name}
                        score={null}
                        eligible={false}
                        explanation={r.explanation}
                        ineligibilityReasons={r.ineligibilityReasons}
                        distanceKm={r.distanceKm}
                        distanceSource={r.distanceSource}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {items.length === 0 && query.data.rankingStatus !== 'NOT_RUN' ? <EmptyState compact title="No NGOs found nearby" description="No verified NGO is within range of this pickup location." /> : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
