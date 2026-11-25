import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { DailyMetric, DailyMetricInput, ForecastAccuracy, SurplusForecast } from '@/types';

/** GET /predictions/surplus (rate-limited: cached for 10 minutes). */
export function useSurplusForecast(enabled = true, date?: string) {
  return useQuery({
    queryKey: qk.predictions.surplus(date),
    queryFn: () => apiGet<SurplusForecast>('/predictions/surplus', date ? { date } : undefined),
    enabled,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useForecastAccuracy() {
  return useQuery({ queryKey: qk.predictions.accuracy, queryFn: () => apiGet<ForecastAccuracy>('/predictions/accuracy') });
}

export function useDailyMetrics(days: number) {
  return useQuery({ queryKey: qk.predictions.metrics(days), queryFn: () => apiGet<DailyMetric[]>('/donors/me/metrics', { days }) });
}

export function useRecordMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DailyMetricInput) => apiPost<unknown>('/donors/me/metrics', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['predictions'] }),
  });
}
