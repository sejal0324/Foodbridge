import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { FeeEstimate, Unit } from '@/types';

/** GET /billing/fee-estimate: the NGO service fee for a quantity (estimate only). */
export function useFeeEstimate(unit: Unit, quantity: number, enabled = true) {
  return useQuery({
    queryKey: qk.billing.feeEstimate(unit, quantity),
    queryFn: () => apiGet<FeeEstimate>('/billing/fee-estimate', { unit, quantity }),
    enabled: enabled && Number.isInteger(quantity) && quantity > 0,
    staleTime: 5 * 60_000,
  });
}
