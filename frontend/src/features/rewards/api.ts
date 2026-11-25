import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPost } from '@/services/apiClient';
import { downloadFile } from '@/services/download';
import { qk } from '@/services/queryKeys';
import type { ImpactCertificate, LeaderboardEntry, RewardBalance, RewardTransaction } from '@/types';

export function useRewardBalance(enabled = true) {
  return useQuery({ queryKey: qk.rewards.balance, queryFn: () => apiGet<RewardBalance>('/rewards/balance'), enabled });
}

export function useRewardHistory(page: number) {
  return useQuery({ queryKey: qk.rewards.history(page), queryFn: () => apiGetPage<RewardTransaction>('/rewards/history', { page, pageSize: 10 }), placeholderData: keepPreviousData });
}

export function useLeaderboard(month?: string) {
  return useQuery({ queryKey: qk.rewards.leaderboard(month), queryFn: () => apiGet<LeaderboardEntry[]>('/rewards/leaderboard', month ? { month } : undefined) });
}

export function useCertificates() {
  return useQuery({ queryKey: qk.rewards.certificates, queryFn: () => apiGet<ImpactCertificate[]>('/rewards/certificates') });
}

export function useIssueCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { periodStart: string; periodEnd: string }) => apiPost<ImpactCertificate>('/rewards/certificates', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.rewards.certificates }),
  });
}

export function downloadCertificate(c: Pick<ImpactCertificate, 'id' | 'certificateNumber'>) {
  return downloadFile(`/rewards/certificates/${c.id}/pdf`, `${c.certificateNumber}.pdf`);
}
