import { RefreshCw, Sparkles } from 'lucide-react';
import { QueryState } from '@/components/feedback';
import { Button, Card, CardBody, CardHeader, EmptyState, useToast } from '@/components/ui';
import { RankingStatusBanner, RecommendationCard, useDonorRecommendations, useRefreshMatches } from '@/features/matching';
import { ApiError } from '@/services/apiError';
import { formatRelative } from '@/utils/format';

/** Donors ranked for an assistance request, with the criteria breakdown and a manual refresh. */
export function RecommendedDonorsCard({ requestId, open }: { requestId: string; open: boolean }) {
  const query = useDonorRecommendations(requestId);
  const refresh = useRefreshMatches();
  const toast = useToast();
  const items = query.data ? [...query.data.items].sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.rank ?? 999) - (b.rank ?? 999)) : [];
  const eligible = items.filter((i) => i.eligible).length;
  return (
    <Card>
      <CardHeader
        title="Recommended donors"
        description={query.data ? `${eligible} eligible of ${items.length} considered${items[0] ? ` · ranked ${formatRelative(items[0].createdAt)}` : ''}` : 'Donors nearby who are likely to help'}
        icon={<Sparkles className="size-4" aria-hidden="true" />}
        actions={
          open ? (
            <Button
              size="sm"
              variant="ghost"
              loading={refresh.isPending}
              leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}
              onClick={() =>
                refresh.mutate(
                  { requestId },
                  {
                    onSuccess: () => toast.success('Matches refreshed'),
                    onError: (e) => {
                      const err = ApiError.from(e);
                      if (err.code === 'RATE_LIMITED') toast.show({ title: 'Please wait a minute', description: 'Matching can be refreshed a few times per minute.', tone: 'warning' });
                      else toast.error(err);
                    },
                  },
                )
              }
            >
              Refresh matches
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        <QueryState query={query} isEmpty={(d) => d.items.length === 0 && d.rankingStatus !== 'NO_ELIGIBLE_CANDIDATES' && d.rankingStatus !== 'NOT_RUN'} empty={<EmptyState compact title="No donors were found nearby" />}>
          {(data) => (
            <>
              <RankingStatusBanner status={data.rankingStatus} candidateNoun="donors" />
              {data.rankingStatus === 'NOT_RUN' ? null : (
                <div className="space-y-3">
                  {items.map((r) => (
                    <RecommendationCard
                      key={r.candidate.id}
                      title={r.candidate.name}
                      score={r.score}
                      rank={r.rank}
                      eligible={r.eligible}
                      explanation={r.explanation}
                      limitations={r.limitations}
                      criteria={r.criteria}
                      ineligibilityReasons={r.ineligibilityReasons}
                      distanceKm={r.distanceKm}
                      distanceSource={r.distanceSource}
                      rankingStatus={r.rankingStatus}
                      response={r.response}
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">Matching donors are notified automatically. Their response (offered, declined, unavailable) appears on each card.</p>
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
