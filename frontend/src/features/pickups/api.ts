import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthedObjectUrl } from '@/hooks/useAuthedObjectUrl';
import { apiGet, apiPost } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { HandoverResult, Pickup, PickupDetail, VerifyQrResult } from '@/types';

export function usePickups(params: { active?: boolean; status?: string } = {}) {
  const q = { ...(params.active ? { active: 'true' } : {}), ...(params.status ? { status: params.status } : {}) };
  return useQuery({ queryKey: qk.pickups.list(q), queryFn: () => apiGet<Pickup[]>('/pickups', q) });
}

export function usePickup(id: string | undefined, options: { refetchInterval?: number | false } = {}) {
  return useQuery({ queryKey: qk.pickups.detail(id ?? ''), queryFn: () => apiGet<PickupDetail>(`/pickups/${id}`), enabled: Boolean(id), refetchInterval: options.refetchInterval });
}

function useStorePickup() {
  const qc = useQueryClient();
  return (pickup: PickupDetail) => {
    qc.setQueryData(qk.pickups.detail(pickup.id), pickup);
    void qc.invalidateQueries({ queryKey: qk.pickups.all, refetchType: 'none' });
    void qc.invalidateQueries({ queryKey: ['pickups', 'list'] });
  };
}

/** Donor verification steps (see features/pickups/verification.ts for the step machine). */
export function usePickupVerification() {
  const store = useStorePickup();
  const qc = useQueryClient();
  return {
    verifyQr: useMutation({ mutationFn: (token: string) => apiPost<VerifyQrResult>('/pickups/verify-qr', { token }), onSuccess: (r) => store(r.pickup) }),
    confirmIdentity: useMutation({ mutationFn: (pickupId: string) => apiPost<PickupDetail>('/pickups/confirm-identity', { pickupId }), onSuccess: store }),
    confirmHandover: useMutation({
      mutationFn: (v: { pickupId: string; quantity: number; notes?: string }) => apiPost<HandoverResult>('/pickups/confirm-handover', v),
      onSuccess: (r) => {
        store(r.pickup);
        void qc.invalidateQueries({ queryKey: qk.rewards.all });
        void qc.invalidateQueries({ queryKey: qk.donations.all });
      },
    }),
  };
}

export function useReportPickupFailure() {
  const store = useStorePickup();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pickupId: string; reason: string }) => apiPost<PickupDetail>(`/pickups/${v.pickupId}/report-failure`, { reason: v.reason }),
    onSuccess: (p) => {
      store(p);
      void qc.invalidateQueries({ queryKey: qk.donations.all });
    },
  });
}

/** Representative photo, fetched with auth as a blob (only when `hasPhoto`). */
export function useRepresentativePhoto(representativeId: string | undefined, hasPhoto: boolean) {
  return useAuthedObjectUrl(representativeId && hasPhoto ? `/representatives/${representativeId}/photo` : null, qk.representatives.photo(representativeId ?? ''));
}
