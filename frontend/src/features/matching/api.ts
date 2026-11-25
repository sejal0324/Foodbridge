import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { AllocationProposal, RecommendationList, RecommendedAssistanceRequest, RecommendedDonation } from '@/types';

/** Ranked NGOs for a donor's donation (GET /matching/ngos). */
export function useNgoRecommendations(donationId: string, enabled = true) {
  return useQuery({
    queryKey: qk.matching.ngosForDonation(donationId),
    queryFn: () => apiGet<RecommendationList>('/matching/ngos', { donationId }),
    enabled,
    // Matching runs in the background right after publishing: poll until the first run lands.
    refetchInterval: pollUntilMatched,
  });
}

/** Ranked donors for an NGO's assistance request (GET /matching/donors). */
export function useDonorRecommendations(requestId: string, enabled = true) {
  return useQuery({
    queryKey: qk.matching.donorsForRequest(requestId),
    queryFn: () => apiGet<RecommendationList>('/matching/donors', { requestId }),
    enabled,
    refetchInterval: pollUntilMatched,
  });
}

/** Poll every 3 s while matching has not run yet, for at most 2 minutes; then stop. */
const MATCH_POLL_MS = 3000;
const MATCH_POLL_LIMIT = 40;
function pollUntilMatched(query: { state: { data?: RecommendationList; dataUpdateCount: number } }): number | false {
  return query.state.data?.rankingStatus === 'NOT_RUN' && query.state.dataUpdateCount < MATCH_POLL_LIMIT ? MATCH_POLL_MS : false;
}

/** Re-runs matching (rate-limited server-side to 6/min). */
export function useRefreshMatches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: { donationId: string } | { requestId: string }) => apiPost<RecommendationList>('/matching/refresh', target),
    onSuccess: (data, target) => {
      if ('donationId' in target) qc.setQueryData(qk.matching.ngosForDonation(target.donationId), data);
      else qc.setQueryData(qk.matching.donorsForRequest(target.requestId), data);
    },
  });
}

/** Suggested split of a donation across pending requests (recommendation only; nothing is reserved). */
export function useAllocationProposal() {
  return useMutation({ mutationFn: (target: { donationId: string } | { assistanceRequestId: string }) => apiPost<AllocationProposal>('/matching/allocate', target) });
}

/** Open NGO requests recommended to the signed-in donor. */
export function useRecommendedAssistanceRequests(enabled = true) {
  return useQuery({ queryKey: qk.matching.requestsForDonor, queryFn: () => apiGet<RecommendedAssistanceRequest[]>('/matching/assistance-requests'), enabled });
}

/** Open donations recommended to the signed-in NGO. */
export function useRecommendedDonations(enabled = true) {
  return useQuery({ queryKey: qk.matching.donationsForNgo, queryFn: () => apiGet<RecommendedDonation[]>('/matching/donations'), enabled });
}
