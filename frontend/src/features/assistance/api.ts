import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPatch, apiPost, newIdempotencyKey } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { AssistanceRequest, AssistanceRequestDetail, MyOffer, Offer, OfferConfirmInput, OfferCreateInput } from '@/types';

export interface AssistanceListParams {
  page: number;
  pageSize?: number;
  scope?: 'open' | 'mine' | 'all';
  status?: string;
  maxDistanceKm?: number;
}

export function useAssistanceRequests(params: AssistanceListParams, enabled = true) {
  const q = {
    page: params.page,
    pageSize: params.pageSize ?? 20,
    ...(params.scope ? { scope: params.scope } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.maxDistanceKm ? { maxDistanceKm: params.maxDistanceKm } : {}),
  };
  return useQuery({ queryKey: qk.assistance.list(q), queryFn: () => apiGetPage<AssistanceRequest>('/assistance-requests', q), placeholderData: keepPreviousData, enabled });
}

export function useAssistanceRequest(id: string | undefined) {
  return useQuery({ queryKey: qk.assistance.detail(id ?? ''), queryFn: () => apiGet<AssistanceRequestDetail>(`/assistance-requests/${id}`), enabled: Boolean(id) });
}

function useInvalidateAssistance() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.assistance.all }),
      qc.invalidateQueries({ queryKey: qk.matching.all }),
      qc.invalidateQueries({ queryKey: qk.donations.all }),
      qc.invalidateQueries({ queryKey: qk.allocations.all }),
    ]);
}

/** POST /assistance-requests/:id/offers (Idempotency-Key per submit). */
export function useCreateOffer(requestId: string) {
  const invalidate = useInvalidateAssistance();
  return useMutation({
    mutationFn: (input: OfferCreateInput) => apiPost<Offer>(`/assistance-requests/${requestId}/offers`, input, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
    onSuccess: () => invalidate(),
  });
}

/** Decline or mark unavailable for a request the donor was matched to. */
export function useRespondToRequest() {
  const invalidate = useInvalidateAssistance();
  return useMutation({
    mutationFn: (v: { requestId: string; response: 'DECLINED' | 'UNAVAILABLE'; note?: string }) =>
      apiPost<{ updated: number }>(`/assistance-requests/${v.requestId}/respond`, { response: v.response, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => invalidate(),
  });
}

export function useMyOffers(enabled = true) {
  return useQuery({ queryKey: qk.assistance.myOffers, queryFn: () => apiGet<MyOffer[]>('/offers/mine'), enabled });
}

export function useConfirmOffer() {
  const invalidate = useInvalidateAssistance();
  return useMutation({ mutationFn: (v: { offerId: string; input: OfferConfirmInput }) => apiPatch<Offer>(`/offers/${v.offerId}/confirm`, v.input), onSuccess: () => invalidate() });
}

export function useCancelOffer() {
  const invalidate = useInvalidateAssistance();
  return useMutation({ mutationFn: (v: { offerId: string; reason: string }) => apiPost(`/offers/${v.offerId}/cancel`, { reason: v.reason }), onSuccess: () => invalidate() });
}
