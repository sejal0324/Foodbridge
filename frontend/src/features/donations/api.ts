import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPatch, apiPost, newIdempotencyKey } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { Allocation, CreatedDonation, Donation, DonationCreateInput, DonationDetail, DonationRequest, DonationUpdateInput, FoodCategory } from '@/types';

export function useFoodCategories() {
  return useQuery({ queryKey: qk.foodCategories, queryFn: () => apiGet<FoodCategory[]>('/food-categories'), staleTime: 60 * 60_000 });
}

export interface DonationListParams {
  page: number;
  pageSize?: number;
  /** Comma-separated statuses, e.g. "AVAILABLE,PARTIALLY_RESERVED". */
  status?: string;
  sort?: 'newest' | 'deadline' | 'distance';
}

export function useDonations(params: DonationListParams) {
  const q = { page: params.page, pageSize: params.pageSize ?? 20, sort: params.sort ?? 'newest', ...(params.status ? { status: params.status } : {}) };
  return useQuery({ queryKey: qk.donations.list(q), queryFn: () => apiGetPage<Donation>('/donations', q), placeholderData: keepPreviousData });
}

export function useDonation(id: string | undefined) {
  return useQuery({ queryKey: qk.donations.detail(id ?? ''), queryFn: () => apiGet<DonationDetail>(`/donations/${id}`), enabled: Boolean(id) });
}

function useInvalidateDonationData() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.donations.all }),
      qc.invalidateQueries({ queryKey: qk.requests.all }),
      qc.invalidateQueries({ queryKey: qk.allocations.all }),
      qc.invalidateQueries({ queryKey: qk.matching.all }),
      qc.invalidateQueries({ queryKey: qk.pickups.all }),
    ]);
}

/** POST /donations with a fresh Idempotency-Key per submit attempt. */
export function useCreateDonation() {
  const invalidate = useInvalidateDonationData();
  return useMutation({
    mutationFn: (input: DonationCreateInput) => apiPost<CreatedDonation>('/donations', input, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateDonation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DonationUpdateInput) => apiPatch<DonationDetail>(`/donations/${id}`, input),
    onSuccess: (data) => {
      qc.setQueryData(qk.donations.detail(id), data);
      void qc.invalidateQueries({ queryKey: qk.donations.all });
    },
  });
}

export function useCancelDonation(id: string) {
  const invalidate = useInvalidateDonationData();
  return useMutation({ mutationFn: (reason: string) => apiPost(`/donations/${id}/cancel`, { reason }), onSuccess: () => invalidate() });
}

export function useDonationRequests(params: { page?: number; pageSize?: number; status?: string; donationId?: string }, enabled = true) {
  const q = { page: params.page ?? 1, pageSize: params.pageSize ?? 20, ...(params.status ? { status: params.status } : {}), ...(params.donationId ? { donationId: params.donationId } : {}) };
  return useQuery({ queryKey: qk.requests.list(q), queryFn: () => apiGetPage<DonationRequest>('/requests', q), enabled });
}

export function useApproveRequest() {
  const invalidate = useInvalidateDonationData();
  return useMutation({
    mutationFn: (v: { requestId: string; quantity?: number }) =>
      apiPatch<{ requestId: string; allocationId: string; approvedQuantity: number }>(`/requests/${v.requestId}/approve`, v.quantity ? { quantity: v.quantity } : {}),
    onSuccess: () => invalidate(),
  });
}

export function useRejectRequest() {
  const invalidate = useInvalidateDonationData();
  return useMutation({
    mutationFn: (v: { requestId: string; reason?: string }) => apiPatch(`/requests/${v.requestId}/reject`, v.reason ? { reason: v.reason } : {}),
    onSuccess: () => invalidate(),
  });
}

export function useApproveBatch(donationId: string) {
  const invalidate = useInvalidateDonationData();
  return useMutation({
    mutationFn: (allocations: { requestId: string; quantity: number }[]) => apiPost<unknown>(`/donations/${donationId}/approve-batch`, { allocations }),
    onSuccess: () => invalidate(),
  });
}

export function useAllocations(params: { page?: number; pageSize?: number; status?: string } = {}, enabled = true) {
  const q = { page: params.page ?? 1, pageSize: params.pageSize ?? 100, ...(params.status ? { status: params.status } : {}) };
  return useQuery({ queryKey: qk.allocations.list(q), queryFn: () => apiGetPage<Allocation>('/allocations', q), enabled });
}

export function useCancelAllocation() {
  const invalidate = useInvalidateDonationData();
  return useMutation({ mutationFn: (v: { allocationId: string; reason: string }) => apiPost(`/allocations/${v.allocationId}/cancel`, { reason: v.reason }), onSuccess: () => invalidate() });
}
