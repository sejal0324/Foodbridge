import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { TrackingPoint, TrackingSessionView } from '@/types';

export function useTrackingSessionQuery(sessionId: string, refetchInterval: number | false) {
  return useQuery({ queryKey: qk.tracking.session(sessionId), queryFn: () => apiGet<TrackingSessionView>(`/tracking/${sessionId}`), refetchInterval });
}

/** Recorded positions (the API returns newest first, max 500). */
export function useTrackingPathQuery(sessionId: string, refetchInterval: number | false) {
  return useQuery({ queryKey: qk.tracking.path(sessionId), queryFn: () => apiGet<TrackingPoint[]>(`/tracking/${sessionId}/path`), refetchInterval });
}
