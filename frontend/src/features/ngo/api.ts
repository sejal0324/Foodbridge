import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoleAnalytics } from '@/features/analytics/api';
import { apiClient, apiGet, apiGetPage, apiPatch, apiPost, apiPut, newIdempotencyKey } from '@/services/apiClient';
import { downloadFile } from '@/services/download';
import { qk } from '@/services/queryKeys';
import type { AssistanceCreateInput, AssistanceRequest, DietaryType, Donation, HandoverResult, Offer, PickupDetail, TrackingSessionView } from '@/types';
import type {
  AcceptedOffer,
  BillingLine,
  BillingSummary,
  CollectionPlan,
  CollectionPlanSummary,
  DonationRequestCreated,
  Invoice,
  LocationInput,
  LocationResult,
  NgoAnalytics,
  NgoProfile,
  NgoProfileUpdate,
  Payment,
  PaymentOrder,
  PaymentVerifyResult,
  PickupPass,
  PlanCreateInput,
  Representative,
  RepresentativeCreateInput,
  RepresentativeCreated,
  TrackingEventType,
  TrackingStage,
} from './types';

/**
 * NGO-area API hooks. Shared hooks (requests list, allocations, pickups,
 * matching, fee estimate…) are reused from their feature folders; keys that
 * `qk` does not cover live in `ngoKeys` below.
 */
export const ngoKeys = {
  representatives: ['ngo', 'representatives'] as const,
  plans: {
    all: ['ngo', 'plans'] as const,
    detail: (id: string) => ['ngo', 'plans', id] as const,
  },
  billing: {
    all: ['billing'] as const,
    summary: ['billing', 'summary'] as const,
    history: (page: number) => ['billing', 'history', page] as const,
    invoices: ['billing', 'invoices'] as const,
    payments: ['billing', 'payments'] as const,
  },
};

// --- Profile ---------------------------------------------------------------------------
export function useNgoProfile(enabled = true) {
  return useQuery({ queryKey: qk.profile.ngo, queryFn: () => apiGet<NgoProfile>('/ngos/me'), enabled, staleTime: 60_000 });
}

export function useUpdateNgoProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NgoProfileUpdate) => apiPatch<NgoProfile>('/ngos/me', input),
    onSuccess: (data) => {
      qc.setQueryData(qk.profile.ngo, data);
      void qc.invalidateQueries({ queryKey: qk.matching.all });
      void qc.invalidateQueries({ queryKey: qk.donations.all });
    },
  });
}

export function useSetFoodPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryIds: string[]) => apiPut<unknown>('/ngos/me/food-preferences', { categoryIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profile.ngo });
      void qc.invalidateQueries({ queryKey: qk.matching.all });
    },
  });
}

// --- Marketplace and donation requests ----------------------------------------------------
export interface MarketplaceParams {
  page: number;
  pageSize: number;
  sort: 'distance' | 'deadline' | 'newest';
  dietaryType?: DietaryType;
  categoryId?: string;
  /** Omit for "anywhere in India". */
  maxDistanceKm?: number;
}

/** GET /donations as an NGO (scope "marketplace": open listings with `distanceKm` from the NGO). */
export function useMarketplace(params: MarketplaceParams, enabled = true) {
  const q = {
    scope: 'marketplace',
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    ...(params.dietaryType ? { dietaryType: params.dietaryType } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.maxDistanceKm ? { maxDistanceKm: params.maxDistanceKm } : {}),
  };
  return useQuery({ queryKey: qk.donations.list(q), queryFn: () => apiGetPage<Donation>('/donations', q), placeholderData: keepPreviousData, enabled });
}

/** POST /donations/:id/requests with a fresh Idempotency-Key per submit attempt. Returns the fee estimate. */
export function useCreateDonationRequest(donationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { quantity: number; message?: string }) =>
      apiPost<DonationRequestCreated>(`/donations/${donationId}/requests`, input, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.requests.all });
      void qc.invalidateQueries({ queryKey: qk.donations.detail(donationId) });
    },
  });
}

export function useWithdrawRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => apiPatch(`/requests/${requestId}/withdraw`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.requests.all });
      void qc.invalidateQueries({ queryKey: qk.donations.all });
    },
  });
}

// --- Assistance requests and offers ------------------------------------------------------
function useInvalidateAssistance() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.assistance.all }),
      qc.invalidateQueries({ queryKey: qk.matching.all }),
      qc.invalidateQueries({ queryKey: qk.allocations.all }),
      qc.invalidateQueries({ queryKey: qk.analytics.role('NGO') }),
    ]);
}

/** POST /assistance-requests (Idempotency-Key per submit attempt). */
export function useCreateAssistanceRequest() {
  const invalidate = useInvalidateAssistance();
  return useMutation({
    mutationFn: (input: AssistanceCreateInput) => apiPost<AssistanceRequest>('/assistance-requests', input, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
    onSuccess: () => invalidate(),
  });
}

export interface AssistanceUpdateInput {
  version: number;
  quantityRequired?: number;
  neededFrom?: string;
  neededUntil?: string;
  urgency?: string;
  beneficiariesCount?: number;
  reason?: string;
  additionalRequirements?: string;
}

/** PATCH /assistance-requests/:id with optimistic locking (`409 STALE_VERSION`). */
export function useUpdateAssistanceRequest(id: string) {
  const invalidate = useInvalidateAssistance();
  return useMutation({ mutationFn: (input: AssistanceUpdateInput) => apiPatch<AssistanceRequest>(`/assistance-requests/${id}`, input), onSuccess: () => invalidate() });
}

export function useCancelAssistanceRequest(id: string) {
  const invalidate = useInvalidateAssistance();
  return useMutation({ mutationFn: (reason: string) => apiPost(`/assistance-requests/${id}/cancel`, { reason }), onSuccess: () => invalidate() });
}

/** PATCH /offers/:id/accept `{ quantity? }` (capped server-side at the remaining need). */
export function useAcceptOffer() {
  const invalidate = useInvalidateAssistance();
  return useMutation({
    mutationFn: (v: { offerId: string; quantity?: number }) => apiPatch<AcceptedOffer>(`/offers/${v.offerId}/accept`, v.quantity ? { quantity: v.quantity } : {}),
    onSuccess: () => invalidate(),
  });
}

/** Accepts offers one after another (used to apply an allocation proposal); never throws. */
export function useAcceptOffersSequentially() {
  const invalidate = useInvalidateAssistance();
  return useMutation({
    mutationFn: async (items: { offerId: string; quantity: number }[]) => {
      const results: { offerId: string; ok: boolean; accepted?: AcceptedOffer; error?: unknown }[] = [];
      for (const item of items) {
        try {
          const accepted = await apiPatch<AcceptedOffer>(`/offers/${item.offerId}/accept`, { quantity: item.quantity });
          results.push({ offerId: item.offerId, ok: true, accepted });
        } catch (error) {
          results.push({ offerId: item.offerId, ok: false, error });
        }
      }
      return results;
    },
    onSettled: () => invalidate(),
  });
}

export function useRejectOffer() {
  const invalidate = useInvalidateAssistance();
  return useMutation({
    mutationFn: (v: { offerId: string; reason?: string }) => apiPatch<Offer>(`/offers/${v.offerId}/reject`, v.reason ? { reason: v.reason } : {}),
    onSuccess: () => invalidate(),
  });
}

// --- Representatives ---------------------------------------------------------------------
export function useRepresentatives(enabled = true) {
  return useQuery({ queryKey: ngoKeys.representatives, queryFn: () => apiGet<Representative[]>('/ngos/me/representatives'), enabled });
}

export function useCreateRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RepresentativeCreateInput) => apiPost<RepresentativeCreated>('/ngos/me/representatives', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ngoKeys.representatives });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useSetRepresentativeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'INACTIVE' | 'REVOKED' }) => apiPatch(`/ngos/me/representatives/${v.id}`, { status: v.status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ngoKeys.representatives });
      void qc.invalidateQueries({ queryKey: qk.pickups.all });
    },
  });
}

/** PUT …/:id/photo (multipart `file`, JPEG or PNG). */
export function useUploadRepresentativePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', v.file);
      await apiClient.put(`/ngos/me/representatives/${v.id}/photo`, form);
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ngoKeys.representatives });
      void qc.invalidateQueries({ queryKey: qk.representatives.photo(v.id) });
    },
  });
}

// --- Pickups (NGO side) ------------------------------------------------------------------
function useStorePickup() {
  const qc = useQueryClient();
  return (pickup: PickupDetail) => {
    qc.setQueryData(qk.pickups.detail(pickup.id), pickup);
    void qc.invalidateQueries({ queryKey: ['pickups', 'list'] });
    void qc.invalidateQueries({ queryKey: qk.allocations.all });
  };
}

export interface AssignInput {
  allocationId: string;
  representativeId: string;
  scheduledPickupAt?: string;
  destination?: { location: { lat: number; lng: number }; address: string };
}

/** POST /pickups/assign (also reassigns before verification starts). */
export function useAssignPickup() {
  const store = useStorePickup();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignInput) => apiPost<PickupDetail>('/pickups/assign', input),
    onSuccess: (p) => {
      store(p);
      void qc.invalidateQueries({ queryKey: qk.assistance.all });
      void qc.invalidateQueries({ queryKey: qk.pickups.all });
    },
  });
}

const LIVE_PICKUP_STATUSES = ['ASSIGNED', 'EN_ROUTE', 'VERIFIED', 'HANDED_OVER', 'IN_TRANSIT'];

/** Pickup detail (shared cache key), polled every 15 s while in progress so scans and confirmations appear. */
export function useNgoPickup(id: string | undefined) {
  return useQuery({
    queryKey: qk.pickups.detail(id ?? ''),
    queryFn: () => apiGet<PickupDetail>(`/pickups/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && LIVE_PICKUP_STATUSES.includes(q.state.data.status) ? 15_000 : false),
  });
}

/** POST /pickups/generate-pass (the assigned representative only). A new pass revokes the previous one. */
export function useGeneratePass() {
  return useMutation({ mutationFn: (pickupId: string) => apiPost<PickupPass>('/pickups/generate-pass', { pickupId }) });
}

/** NGO side of the two-way handover confirmation. */
export function useNgoConfirmHandover() {
  const store = useStorePickup();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pickupId: string; quantity: number; notes?: string }) => apiPost<HandoverResult>('/pickups/confirm-handover', v),
    onSuccess: (r) => {
      store(r.pickup);
      void qc.invalidateQueries({ queryKey: ngoKeys.billing.all });
      void qc.invalidateQueries({ queryKey: qk.analytics.role('NGO') });
    },
  });
}

export function useConfirmDelivery(pickupId: string) {
  const store = useStorePickup();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { deliveredQuantity: number; beneficiariesServed?: number; notes?: string }) => apiPost<PickupDetail>(`/pickups/${pickupId}/confirm-delivery`, input),
    onSuccess: (p) => {
      store(p);
      void qc.invalidateQueries({ queryKey: qk.assistance.all });
      void qc.invalidateQueries({ queryKey: qk.analytics.role('NGO') });
    },
  });
}

// --- LiveTrack sharing (plain calls: the sharing hook drives them) ------------------------------
export const trackingApi = {
  start: (pickupId: string, stage: TrackingStage) => apiPost<TrackingSessionView>('/tracking/start', { pickupId, stage, consent: true }),
  location: (input: LocationInput) => apiPost<LocationResult>('/tracking/location', input),
  stop: (sessionId: string, reason?: string) => apiPost<TrackingSessionView>('/tracking/stop', { sessionId, ...(reason ? { reason } : {}) }),
  event: (target: { sessionId: string } | { pickupId: string }, type: TrackingEventType, detail?: string) =>
    apiPost<{ recorded: boolean }>('/tracking/events', { ...target, type, ...(detail ? { detail: detail.slice(0, 300) } : {}) }),
};

// --- Collection planning -----------------------------------------------------------------
export function useCollectionPlans(enabled = true) {
  return useQuery({ queryKey: ngoKeys.plans.all, queryFn: () => apiGet<CollectionPlanSummary[]>('/collection-plans'), enabled });
}

export function useCollectionPlan(id: string | undefined) {
  return useQuery({ queryKey: ngoKeys.plans.detail(id ?? ''), queryFn: () => apiGet<CollectionPlan>(`/collection-plans/${id}`), enabled: Boolean(id) });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlanCreateInput) => apiPost<CollectionPlan>('/collection-plans', input),
    onSuccess: (plan) => {
      qc.setQueryData(ngoKeys.plans.detail(plan.id), plan);
      void qc.invalidateQueries({ queryKey: ngoKeys.plans.all, exact: true });
    },
  });
}

export function useSetPlanStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED') => apiPatch<CollectionPlan>(`/collection-plans/${id}/status`, { status }),
    onSuccess: (plan) => {
      qc.setQueryData(ngoKeys.plans.detail(id), plan);
      void qc.invalidateQueries({ queryKey: ngoKeys.plans.all, exact: true });
    },
  });
}

// --- Billing -----------------------------------------------------------------------------
export function useBillingSummary(enabled = true) {
  return useQuery({ queryKey: ngoKeys.billing.summary, queryFn: () => apiGet<BillingSummary>('/billing/summary'), enabled });
}

export function useBillingHistory(page: number) {
  return useQuery({ queryKey: ngoKeys.billing.history(page), queryFn: () => apiGetPage<BillingLine>('/billing/history', { page, pageSize: 20 }), placeholderData: keepPreviousData });
}

export function useInvoices() {
  return useQuery({ queryKey: ngoKeys.billing.invoices, queryFn: () => apiGet<Invoice[]>('/billing/invoices') });
}

export function usePayments() {
  return useQuery({ queryKey: ngoKeys.billing.payments, queryFn: () => apiGet<Payment[]>('/billing/payments') });
}

/** POST /billing/payments: a Razorpay order, or `503 PAYMENTS_NOT_CONFIGURED`. */
export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => apiPost<PaymentOrder>('/billing/payments', { invoiceId }),
    onSettled: () => qc.invalidateQueries({ queryKey: ngoKeys.billing.payments }),
  });
}

/** POST /billing/payments/verify: a verified checkout only makes the payment PENDING (the webhook confirms capture). */
export function useVerifyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { orderId: string; paymentId: string; signature: string }) => apiPost<PaymentVerifyResult>('/billing/payments/verify', v),
    onSettled: () => qc.invalidateQueries({ queryKey: ngoKeys.billing.all }),
  });
}

export function downloadInvoicePdf(invoice: Pick<Invoice, 'id' | 'invoiceNumber'>) {
  return downloadFile(`/billing/invoices/${invoice.id}/pdf`, `${invoice.invoiceNumber}.pdf`);
}

// --- Analytics ---------------------------------------------------------------------------
export function useNgoAnalytics(enabled = true) {
  return useRoleAnalytics<NgoAnalytics>('NGO', enabled);
}
