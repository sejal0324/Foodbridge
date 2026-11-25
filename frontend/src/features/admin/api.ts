import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoleAnalytics } from '@/features/analytics/api';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPut } from '@/services/apiClient';
import { downloadFile } from '@/services/download';
import { qk } from '@/services/queryKeys';
import type { Donation } from '@/types';
import { adminKeys } from './queryKeys';
import type {
  ActiveTrackingSession,
  AdminAnalytics,
  AdminUser,
  AdminVerificationDocument,
  AiPerformance,
  AuditLogEntry,
  Dispute,
  DisputeResolveBody,
  DisputeStatus,
  FeeLine,
  FeeRuleRow,
  GeneratedInvoice,
  Invoice,
  JobsResponse,
  JobStatus,
  ManualPaymentInput,
  NotificationDelivery,
  OrgType,
  PaymentRow,
  PlatformSetting,
  ReadinessReport,
  RewardAdjustmentInput,
  RewardRuleInput,
  RewardRuleRow,
  VerificationApplication,
  VerificationLogEntry,
} from './types';

const orgPath = (type: OrgType) => (type === 'DONOR' ? 'donor' : 'ngo');

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
/** GET /analytics/admin (shares its cache with the top-bar "Demo data" pill). */
export function useAdminAnalytics() {
  return useRoleAnalytics<AdminAnalytics>('ADMIN');
}

function useInvalidateOverview() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.analytics.role('ADMIN') });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
export interface VerificationQueueParams {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  type?: OrgType;
}

export function useVerificationQueue(params: VerificationQueueParams, enabled = true) {
  const q = { status: params.status ?? 'PENDING', ...(params.type ? { type: params.type } : {}) };
  return useQuery({ queryKey: adminKeys.verifications(q), queryFn: () => apiGet<VerificationApplication[]>('/admin/verifications', q), enabled });
}

export function useOrganisationDocuments(type: OrgType | undefined, id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.orgDocuments(type ?? '', id ?? ''),
    queryFn: () => apiGet<AdminVerificationDocument[]>(`/admin/organizations/${orgPath(type as OrgType)}/${id}/documents`),
    enabled: Boolean(type && id),
  });
}

export function downloadVerificationDocument(doc: Pick<AdminVerificationDocument, 'id' | 'originalFilename'>) {
  return downloadFile(`/verification-documents/${doc.id}/file`, doc.originalFilename || 'document');
}

export function useReviewDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { documentId: string; status: 'ACCEPTED' | 'REJECTED'; notes?: string }) =>
      apiPatch(`/admin/verification-documents/${v.documentId}`, { status: v.status, ...(v.notes ? { notes: v.notes } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'org-documents'] }),
  });
}

export function useDecideVerification() {
  const qc = useQueryClient();
  const invalidateOverview = useInvalidateOverview();
  return useMutation({
    mutationFn: (v: { type: OrgType; id: string; status: 'APPROVED' | 'REJECTED' | 'SUSPENDED'; notes?: string }) =>
      apiPatch(`/admin/organizations/${orgPath(v.type)}/${v.id}/verification`, { status: v.status, ...(v.notes ? { notes: v.notes } : {}) }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: adminKeys.verificationsAll }),
        qc.invalidateQueries({ queryKey: adminKeys.usersAll }),
        invalidateOverview(),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export interface UserListParams {
  page: number;
  pageSize?: number;
  role?: string;
  status?: string;
  search?: string;
}

export function useAdminUsers(params: UserListParams) {
  const q = {
    page: params.page,
    pageSize: params.pageSize ?? 20,
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
  };
  return useQuery({ queryKey: adminKeys.users(q), queryFn: () => apiGetPage<AdminUser>('/admin/users', q), placeholderData: keepPreviousData });
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; status: 'ACTIVE' | 'SUSPENDED'; reason?: string }) =>
      apiPatch(`/admin/users/${v.userId}/status`, { status: v.status, ...(v.reason ? { reason: v.reason } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.usersAll }),
  });
}

// ---------------------------------------------------------------------------
// Donations and assistance requests (role-neutral endpoints, scope=all)
// ---------------------------------------------------------------------------
export interface AdminDonationParams {
  page: number;
  pageSize?: number;
  status?: string;
  categoryId?: string;
  dietaryType?: string;
}

export function useAdminDonations(params: AdminDonationParams) {
  const q = {
    scope: 'all',
    page: params.page,
    pageSize: params.pageSize ?? 20,
    sort: 'newest',
    ...(params.status ? { status: params.status } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.dietaryType ? { dietaryType: params.dietaryType } : {}),
  };
  return useQuery({ queryKey: qk.donations.list(q), queryFn: () => apiGetPage<Donation>('/donations', q), placeholderData: keepPreviousData });
}

export function useAdminCancelAssistanceRequest(id: string) {
  const qc = useQueryClient();
  const invalidateOverview = useInvalidateOverview();
  return useMutation({
    mutationFn: (reason: string) => apiPost(`/assistance-requests/${id}/cancel`, { reason }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.assistance.all }),
        qc.invalidateQueries({ queryKey: qk.donations.all }),
        qc.invalidateQueries({ queryKey: qk.allocations.all }),
        invalidateOverview(),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Pickups: verification log, active tracking, disputes
// ---------------------------------------------------------------------------
export function useVerificationLog() {
  return useQuery({ queryKey: adminKeys.verificationLogs, queryFn: () => apiGet<VerificationLogEntry[]>('/admin/verification-logs') });
}

export function useActiveTrackingSessions() {
  return useQuery({ queryKey: adminKeys.activeTracking, queryFn: () => apiGet<ActiveTrackingSession[]>('/admin/tracking/active'), refetchInterval: 30_000 });
}

export function useDisputes(status: DisputeStatus | '') {
  return useQuery({ queryKey: adminKeys.disputes(status), queryFn: () => apiGet<Dispute[]>('/disputes', status ? { status } : undefined) });
}

export function useResolveDispute() {
  const qc = useQueryClient();
  const invalidateOverview = useInvalidateOverview();
  return useMutation({
    mutationFn: (v: { disputeId: string; body: DisputeResolveBody }) => apiPatch(`/admin/disputes/${v.disputeId}/resolve`, v.body),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: adminKeys.disputesAll }),
        qc.invalidateQueries({ queryKey: qk.pickups.all }),
        qc.invalidateQueries({ queryKey: qk.donations.all }),
        qc.invalidateQueries({ queryKey: adminKeys.billing }),
        invalidateOverview(),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------
export function useRewardRules() {
  return useQuery({ queryKey: adminKeys.rewardRules, queryFn: () => apiGet<RewardRuleRow[]>('/admin/reward-rules') });
}

export function useUpsertRewardRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RewardRuleInput) => apiPost<{ id: string }>('/admin/reward-rules', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.rewardRules }),
  });
}

export function useDeactivateRewardRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/reward-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.rewardRules }),
  });
}

export function useAdjustRewards() {
  const qc = useQueryClient();
  const invalidateOverview = useInvalidateOverview();
  return useMutation({
    mutationFn: (input: RewardAdjustmentInput) => apiPost<{ id: string; balanceAfter: number }>('/admin/rewards/adjust', input),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: qk.rewards.all }), invalidateOverview()]),
  });
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export function useFeeRules() {
  return useQuery({ queryKey: adminKeys.feeRules, queryFn: () => apiGet<FeeRuleRow[]>('/admin/fee-rules') });
}

export function useSetFeeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { unit: string; amountPerUnit: number; description?: string }) => apiPost<{ id: string }>('/admin/fee-rules', v),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: adminKeys.feeRules }), qc.invalidateQueries({ queryKey: ['billing', 'fee-estimate'] })]),
  });
}

export function useAdminInvoices() {
  return useQuery({ queryKey: adminKeys.invoices, queryFn: () => apiGet<Invoice[]>('/billing/invoices') });
}

export function useAdminFeeLines(page: number) {
  return useQuery({ queryKey: adminKeys.feeLines(page), queryFn: () => apiGetPage<FeeLine>('/billing/history', { page, pageSize: 20 }), placeholderData: keepPreviousData });
}

export function useAdminPayments() {
  return useQuery({ queryKey: adminKeys.payments, queryFn: () => apiGet<PaymentRow[]>('/billing/payments') });
}

export function useGenerateInvoices() {
  const qc = useQueryClient();
  const invalidateOverview = useInvalidateOverview();
  return useMutation({
    mutationFn: (v: { periodStart: string; periodEnd: string }) => apiPost<GeneratedInvoice[]>('/admin/invoices/generate', v),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: adminKeys.billing }), invalidateOverview()]),
  });
}

export function useRecordManualPayment() {
  const qc = useQueryClient();
  const invalidateOverview = useInvalidateOverview();
  return useMutation({
    mutationFn: (input: ManualPaymentInput) => apiPost<{ paymentId: string }>('/admin/payments/manual', input),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: adminKeys.billing }), invalidateOverview()]),
  });
}

export function downloadInvoicePdf(invoice: Pick<Invoice, 'id' | 'invoiceNumber'>) {
  return downloadFile(`/billing/invoices/${invoice.id}/pdf`, `${invoice.invoiceNumber}.pdf`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function usePlatformSettings() {
  return useQuery({ queryKey: adminKeys.settings, queryFn: () => apiGet<PlatformSetting[]>('/admin/settings') });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; value: unknown }) => apiPut<{ key: string; value: unknown }>(`/admin/settings/${encodeURIComponent(v.key)}`, { value: v.value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.settings }),
  });
}

// ---------------------------------------------------------------------------
// Audit, AI, system
// ---------------------------------------------------------------------------
export interface AuditLogParams {
  page: number;
  pageSize?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
}

export function useAuditLogs(params: AuditLogParams) {
  const q = {
    page: params.page,
    pageSize: params.pageSize ?? 25,
    ...(params.action ? { action: params.action } : {}),
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
  };
  return useQuery({ queryKey: adminKeys.auditLogs(q), queryFn: () => apiGetPage<AuditLogEntry>('/admin/audit-logs', q), placeholderData: keepPreviousData });
}

export function useAiPerformance() {
  return useQuery({ queryKey: adminKeys.aiPerformance, queryFn: () => apiGet<AiPerformance>('/admin/ai/performance') });
}

export function useReadiness() {
  return useQuery({ queryKey: adminKeys.readiness, queryFn: () => apiGet<ReadinessReport>('/health/ready'), refetchInterval: 60_000, retry: false });
}

export function useJobs(params: { status: JobStatus; page: number; pageSize?: number }) {
  const q = { status: params.status, page: params.page, pageSize: params.pageSize ?? 20 };
  return useQuery({ queryKey: adminKeys.jobs(q), queryFn: () => apiGet<JobsResponse>('/admin/jobs', q), placeholderData: keepPreviousData });
}

/** Number of DEAD jobs (from the counts returned with any jobs page). */
export function useDeadJobCount() {
  const query = useJobs({ status: 'DEAD', page: 1, pageSize: 1 });
  return { ...query, count: query.data?.counts.DEAD ?? 0 };
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => apiPost(`/admin/jobs/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.jobsAll }) });
}

export function useNotificationDeliveries(params: { status?: string; page: number; pageSize?: number }) {
  const q = { page: params.page, pageSize: params.pageSize ?? 20, ...(params.status ? { status: params.status } : {}) };
  return useQuery({ queryKey: adminKeys.deliveries(q), queryFn: () => apiGet<NotificationDelivery[]>('/admin/notification-deliveries', q), placeholderData: keepPreviousData });
}
