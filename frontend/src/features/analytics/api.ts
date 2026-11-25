import { useQuery } from '@tanstack/react-query';
import { ROLE_ANALYTICS_ENDPOINT } from '@/layouts/navigation';
import { apiGet } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { DataLabel, DonorAnalytics, InsightsResponse, PublicImpact, Role } from '@/types';

/** Role analytics (GET /analytics/donor|ngo|admin). Shared cache with the top-bar "Demo data" pill. */
export function useRoleAnalytics<T extends { dataLabel: DataLabel }>(role: Role, enabled = true) {
  return useQuery({
    queryKey: qk.analytics.role(role),
    queryFn: () => apiGet<T>(ROLE_ANALYTICS_ENDPOINT[role]),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDonorAnalytics(enabled = true) {
  return useRoleAnalytics<DonorAnalytics>('DONOR', enabled);
}

/** GET /analytics/insights (rate-limited server-side: cached for 10 minutes here). */
export function useInsights(enabled = true) {
  return useQuery({
    queryKey: qk.analytics.insights,
    queryFn: () => apiGet<InsightsResponse>('/analytics/insights'),
    enabled,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function usePublicImpact() {
  return useQuery({ queryKey: qk.publicImpact, queryFn: () => apiGet<PublicImpact>('/public/impact'), staleTime: 60_000 });
}
