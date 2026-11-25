import type { DataLabel, DistanceSource, FeeEstimate, LatLng, Offer, TrackingSessionView, Unit, VerificationStatus } from '@/types';

/*
 * NGO-area DTOs mirroring the backend services (profile, representative,
 * planning, billing and analytics). Shared DTOs (donations, pickups, offers…)
 * come from '@/types'.
 */

/** GET /api/ngos/me */
export interface NgoProfile {
  id: string;
  organizationName: string;
  registrationNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  location: LatLng | null;
  timezone: string;
  acceptsVeg: boolean;
  acceptsNonVeg: boolean;
  maxDailyCapacity: number | null;
  collectionRadiusKm: number;
  beneficiariesCount: number;
  beneficiaryDescription: string | null;
  hasRefrigeration: boolean;
  defaultVehicleCapacity: number | null;
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
  verifiedAt: string | null;
  createdAt: string;
  foodPreferences: { id: string; code: string }[];
}

/** PATCH /api/ngos/me (omitted fields are unchanged). */
export interface NgoProfileUpdate {
  organizationName?: string;
  registrationNumber?: string;
  contactPhone?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  location?: LatLng;
  acceptsVeg?: boolean;
  acceptsNonVeg?: boolean;
  maxDailyCapacity?: number;
  collectionRadiusKm?: number;
  beneficiariesCount?: number;
  beneficiaryDescription?: string;
  hasRefrigeration?: boolean;
  defaultVehicleCapacity?: number | null;
}

// --- Representatives -----------------------------------------------------------
export const ID_DOCUMENT_TYPES = ['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID', 'OTHER'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];
export type RepresentativeStatus = 'INVITED' | 'ACTIVE' | 'INACTIVE' | 'REVOKED';

/** GET /api/ngos/me/representatives item. */
export interface Representative {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  accountStatus: string;
  idDocumentType: IdDocumentType | string;
  idDocumentLast4: string;
  hasPhoto: boolean;
  status: RepresentativeStatus | string;
  createdAt: string;
}

export type RepresentativeCreateInput =
  | { self: true; phone: string; idDocumentType: IdDocumentType; idDocumentLast4: string }
  | { self?: false; fullName: string; email: string; phone: string; idDocumentType: IdDocumentType; idDocumentLast4: string };

/** POST /api/ngos/me/representatives response. */
export interface RepresentativeCreated extends Representative {
  inviteUrl: string | null;
  invitationEmailed: boolean;
}

// --- Requests, offers, pickups, tracking ---------------------------------------------
/** POST /api/donations/:id/requests response. */
export interface DonationRequestCreated {
  id: string;
  donationId: string;
  quantity: number;
  status: 'PENDING' | string;
  feeEstimate: FeeEstimate;
}

/** PATCH /api/offers/:id/accept response. */
export interface AcceptedOffer extends Offer {
  feeEstimate: FeeEstimate;
}

/** POST /api/pickups/generate-pass response. */
export interface PickupPass {
  pickupId: string;
  token: string;
  qrPayload: string;
  expiresAt: string;
  ttlMinutes: number;
}

export type TrackingStage = 'TO_PICKUP' | 'TO_DESTINATION';
export type TrackingEventType = 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'DISCONNECTED' | 'RECONNECTED';

export interface LocationInput {
  sessionId: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  heading?: number;
  speedMps?: number;
  recordedAt: string;
}

/** POST /api/tracking/location response. */
export type LocationResult = { accepted: true; session: TrackingSessionView } | { accepted: false; reason: string };

// --- Collection planning -------------------------------------------------------------
export type PlanStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | string;

export interface PlanStop {
  id: string;
  sequence: number | null;
  type: 'PICKUP' | 'DROP_OFF' | string;
  allocationId: string | null;
  location: LatLng;
  address: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  plannedArrivalAt: string | null;
  quantity: number;
  status: 'PENDING' | 'DROPPED' | string;
  dropReason: string | null;
  foodName: string | null;
  donorName: string | null;
}

/** GET /api/collection-plans/:id */
export interface CollectionPlan {
  id: string;
  planDate: string;
  representativeId: string | null;
  vehicleCapacity: number;
  start: { location: LatLng; address: string | null };
  end: { location: LatLng; address: string | null };
  startTime: string;
  status: PlanStatus;
  solver: string | null;
  /** OPTIMAL / FEASIBLE / NO_SOLUTION … from OR-Tools, or UNAVAILABLE when the optimiser is offline. */
  solverStatus: string | null;
  distanceSource: DistanceSource | string | null;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  explanation: string | null;
  infeasibilityReasons: string[] | null;
  createdAt: string;
  stops: PlanStop[];
}

/** GET /api/collection-plans item. */
export interface CollectionPlanSummary {
  id: string;
  planDate: string;
  status: PlanStatus;
  solverStatus: string | null;
  distanceSource: DistanceSource | string | null;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  createdAt: string;
  stopCount: number;
}

export interface PlanCreateInput {
  planDate: string;
  startTime: string;
  vehicleCapacity?: number;
  representativeId?: string;
  start?: { location: LatLng; address?: string };
  end?: { location: LatLng; address?: string };
  allocationIds: string[];
}

// --- Billing -------------------------------------------------------------------------
/** GET /api/billing/summary */
export interface BillingSummary {
  uninvoicedAmount: number;
  outstandingInvoicedAmount: number;
  paidAmount: number;
  thisMonthAmount: number;
  billedCollections: number;
  billedQuantity: number;
  currency: string;
  feeRules: { unit: Unit; amountPerUnit: number; currency: string }[];
  tax: { enabled: boolean; name: string | null; ratePercent: number };
  onlinePaymentsAvailable: boolean;
  notes: string[];
}

/** GET /api/billing/history item (one fee line per confirmed collection). */
export interface BillingLine {
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
  status: 'PENDING' | 'INVOICED' | 'PAID' | 'WAIVED' | 'VOID' | string;
  invoiceId: string | null;
  createdAt: string;
}

/** GET /api/billing/invoices item. */
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
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID' | string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
}

/** GET /api/billing/payments item. */
export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  ngoName: string;
  provider: 'RAZORPAY' | 'MANUAL' | string;
  amount: number;
  currency: string;
  status: 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | string;
  failureReason: string | null;
  referenceNote: string | null;
  createdAt: string;
  succeededAt: string | null;
}

/** POST /api/billing/payments response (a Razorpay order for the outstanding amount). */
export interface PaymentOrder {
  provider: 'RAZORPAY';
  keyId: string;
  orderId: string;
  amount: number;
  amountPaise: number;
  currency: string;
  invoiceNumber: string;
}

/** POST /api/billing/payments/verify response. */
export interface PaymentVerifyResult {
  status: 'PENDING_CONFIRMATION' | 'UNCHANGED' | string;
  message: string;
}

// --- Analytics -----------------------------------------------------------------------
/** GET /api/analytics/ngo */
export interface NgoAnalytics {
  totals: {
    mealsReceived: number;
    completedCollections: number;
    failedCollections: number;
    activeCollections: number;
    quantityDelivered: number;
    beneficiariesServed: number;
  };
  /** Percentage 0–100 (one decimal), or null without completed/failed collections. */
  successfulCollectionRate: number | null;
  monthly: { month: string; quantityReceived: number; quantityRequested: number }[];
  assistanceRequestsByStatus: Record<string, number>;
  fees: { totalBilled: number; outstanding: number; thisMonth: number };
  collectionPerformance: { averageMinutesAssignmentToHandover: number | null; sampleSize: number };
  dataLabel: DataLabel;
}
