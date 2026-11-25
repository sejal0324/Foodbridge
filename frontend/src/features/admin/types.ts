import type { DataLabel, Role, Unit, VerificationStatus } from '@/types';

/**
 * DTOs of the admin endpoints, mirroring the backend services
 * (admin.service, verification.service, analytics.service, reward.service,
 * billing.service, pickup.service, tracking.service, settings.service).
 */

// --- GET /analytics/admin ------------------------------------------------------
export interface MatchingPerformance {
  runs: number;
  fallbackRuns: number;
  eligibleCandidates: number;
  ineligibleCandidates: number;
  notified: number;
  positiveResponses: number;
  negativeResponses: number;
  averageScore: number | null;
  /** Percentage (0–100) of notified candidates who requested or offered; null when nobody was notified. */
  responseRate: number | null;
}

export interface CityDistribution {
  city: string;
  donations: number;
  quantity: number;
  lat: number | null;
  lng: number | null;
}

export interface AdminAnalytics {
  platform: {
    donors: number;
    verifiedDonors: number;
    ngos: number;
    verifiedNgos: number;
    pendingVerifications: number;
    assistanceRequests: number;
    successfulHandovers: number;
    failedPickups: number;
    openDisputes: number;
    mealsRedistributed: number;
  };
  donationsByStatus: { status: string; count: number }[];
  monthly: { month: string; donations: number; quantityRedistributed: number; assistanceRequests: number }[];
  geographicDistribution: CityDistribution[];
  matching: MatchingPerformance;
  rewards: { pointsCredited: number; donorsRewarded: number };
  serviceFeeRevenue: { billed: number; collected: number; outstanding: number };
  dataLabel: DataLabel;
}

// --- Verification ------------------------------------------------------------
export type OrgType = 'DONOR' | 'NGO';

/** GET /admin/verifications item. */
export interface VerificationApplication {
  type: OrgType;
  id: string;
  name: string;
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
  city: string | null;
  ownerName: string;
  ownerEmail: string;
  documentCount: number;
  createdAt: string;
}

/** GET /admin/organizations/:type/:id/documents item. */
export interface AdminVerificationDocument {
  id: string;
  organizationType: OrgType;
  organizationId: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | string;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// --- Users -------------------------------------------------------------------
export type AccountStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  accountStatus: AccountStatus | string;
  organizationName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

// --- Settings ----------------------------------------------------------------
export interface PlatformSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

// --- Audit -------------------------------------------------------------------
export interface AuditLogEntry {
  id: number;
  occurredAt: string;
  actorType: 'USER' | 'SERVICE' | 'SYSTEM' | string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: unknown;
  metadata: unknown;
  requestId: string | null;
  ip: string | null;
}

// --- System ------------------------------------------------------------------
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD';

export interface BackgroundJob {
  id: number;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobsResponse {
  items: BackgroundJob[];
  counts: Partial<Record<JobStatus, number>>;
}

export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface NotificationDelivery {
  id: number;
  channel: string;
  status: DeliveryStatus | string;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
  notificationType: string;
  title: string;
  recipient: string;
}

/** GET /health/ready (public). */
export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: { database: 'ok' | 'unavailable' };
  integrations: { email: string; maps: string; payments: string };
}

// --- Pickups, verification log, tracking, disputes -------------------------------
export interface VerificationLogEntry {
  id: number;
  pickupId: string | null;
  method: 'QR' | 'IDENTITY_CHECK' | string;
  result: 'SUCCESS' | 'FAILURE' | string;
  failureReason: string | null;
  actorEmail: string | null;
  ip: string | null;
  createdAt: string;
}

export interface ActiveTrackingSession {
  id: string;
  stage: 'TO_PICKUP' | 'TO_DESTINATION';
  startedAt: string;
  lastRecordedAt: string | null;
  representativeName: string;
  ngoName: string;
}

export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';

/** GET /disputes item (admin sees all). */
export interface Dispute {
  id: string;
  type: 'QUANTITY_MISMATCH' | string;
  status: DisputeStatus;
  description: string | null;
  resolution: string | null;
  resolvedQuantity: number | null;
  createdAt: string;
  resolvedAt: string | null;
  allocationId: string;
  pickupId: string | null;
  foodName: string;
  unit: Unit;
  donorName: string;
  ngoName: string;
  donorQuantity: number | null;
  ngoQuantity: number | null;
  allocatedQuantity: number;
}

export interface DisputeResolveBody {
  outcome: 'CONFIRM_QUANTITY' | 'CANCEL_COLLECTION';
  resolvedQuantity?: number;
  resolution: string;
}

// --- Rewards -----------------------------------------------------------------
export interface RewardRuleRow {
  id: string;
  unit: Unit;
  basis: 'PER_UNIT' | 'PER_ORDER';
  points: number;
  lifetimeThreshold: number;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface RewardRuleInput {
  unit: Unit;
  basis: 'PER_UNIT' | 'PER_ORDER';
  points: number;
  lifetimeThreshold: number;
  description?: string;
}

export interface RewardAdjustmentInput {
  donorId: string;
  points: number;
  reason: string;
}

// --- Billing -----------------------------------------------------------------
export interface FeeRuleRow {
  id: string;
  unit: Unit;
  amountPerUnit: number;
  currency: string;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface Invoice {
  id: string;
  ngo: { id: string; name: string };
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  currency: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'VOID' | string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
}

export interface FeeLine {
  id: string;
  ngo: { id: string; name: string };
  allocationId: string;
  foodName: string;
  donorName: string;
  unit: Unit;
  billableQuantity: number;
  unitAmount: number;
  baseAmount: number;
  tax: { name: string | null; ratePercent: number; amount: number };
  totalAmount: number;
  currency: string;
  status: 'PENDING' | 'INVOICED' | 'PAID' | 'VOID' | string;
  invoiceId: string | null;
  createdAt: string;
}

export interface PaymentRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  ngoName: string;
  provider: 'MANUAL' | 'RAZORPAY' | string;
  amount: number;
  currency: string;
  status: string;
  failureReason: string | null;
  referenceNote: string | null;
  createdAt: string;
  succeededAt: string | null;
}

export interface GeneratedInvoice {
  invoiceId: string;
  ngoId: string;
  total: number;
}

export interface ManualPaymentInput {
  invoiceId: string;
  amount: number;
  reference: string;
}

/** billing.tax setting value. */
export interface TaxSetting {
  enabled: boolean;
  name: string;
  rate_percent: number;
}

// --- AI performance ------------------------------------------------------------
export interface ModelVersionRow {
  modelName: string;
  version: string;
  algorithm: string;
  trainingDataLabel: DataLabel | string;
  isActive: boolean;
  firstSeenAt: string;
}

export interface ServiceModelInfo {
  version?: string;
  algorithm?: string;
  trained_at?: string;
  training_data_label?: string;
  metrics?: Record<string, number | string | null>;
}

export interface AiPerformance {
  service: { status: 'ok' | 'unavailable'; service?: string; version?: string; models?: Record<string, ServiceModelInfo>; llm?: { provider?: string; configured?: boolean } } & Record<string, unknown>;
  models: ModelVersionRow[];
  liveForecastAccuracy: { sampleSize: number; meanAbsoluteError: number | null; note: string };
  matching: MatchingPerformance;
}
