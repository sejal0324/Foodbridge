import type { DistanceSource, LatLng } from './api';
import type { DietaryType, NamedRef, Unit } from './common';
import type { AllocationStatus } from './donations';

export type PickupStatus = 'ASSIGNED' | 'EN_ROUTE' | 'VERIFIED' | 'HANDED_OVER' | 'IN_TRANSIT' | 'DELIVERED' | 'DISPUTED' | 'CANCELLED' | 'FAILED';
export type HandoverStatus = 'PENDING_DONOR' | 'PENDING_NGO' | 'CONFIRMED' | 'DISPUTED';
export type PickupViewer = 'DONOR' | 'NGO_OWNER' | 'REPRESENTATIVE' | 'ADMIN';

export interface PickupRepresentative {
  id: string;
  name: string;
  /** Masked for donors. */
  phone: string | null;
  idDocumentType: string;
  idDocumentLast4: string;
  hasPhoto: boolean;
  status: string;
}

export interface Pickup {
  id: string;
  allocationId: string;
  status: PickupStatus;
  viewer: PickupViewer;
  donation: {
    id: string;
    foodName: string;
    unit: Unit;
    dietaryType: DietaryType;
    quantity: number;
    pickupDeadline: string;
    address: string;
    location: LatLng;
  };
  donor: NamedRef;
  ngo: NamedRef;
  representative: PickupRepresentative;
  scheduledPickupAt: string | null;
  destination: { location: LatLng; address: string | null } | null;
  checks: { qrVerifiedAt: string | null; identityConfirmedAt: string | null };
  handedOverAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  allocationStatus: AllocationStatus;
  createdAt: string;
}

export interface TrackingSessionRef {
  id: string;
  stage: 'TO_PICKUP' | 'TO_DESTINATION';
  status: 'ACTIVE' | 'ENDED' | string;
  lastRecordedAt: string | null;
}

/** GET /api/pickups/:id */
export interface PickupDetail extends Pickup {
  handover: {
    status: HandoverStatus;
    donorConfirmedQuantity: number | null;
    ngoReceivedQuantity: number | null;
    donorConfirmedAt: string | null;
    ngoConfirmedAt: string | null;
  } | null;
  delivery: { deliveredQuantity: number; confirmedAt: string; beneficiariesServed: number | null } | null;
  trackingSessions: TrackingSessionRef[];
}

/** POST /api/pickups/verify-qr */
export interface VerifyQrResult {
  pickup: PickupDetail;
}

export interface HandoverResult {
  outcome: 'WAITING' | 'CONFIRMED' | 'DISPUTED';
  pickup: PickupDetail;
}

/** Reasons in `error.details.reason` of 422 QR_REJECTED. */
export type QrRejectionReason =
  | 'TOKEN_NOT_FOUND'
  | 'WRONG_DONOR'
  | 'TOKEN_REVOKED'
  | 'TOKEN_CONSUMED'
  | 'TOKEN_EXPIRED'
  | 'REPRESENTATIVE_INACTIVE'
  | 'PICKUP_NOT_ACTIVE';

// --- LiveTrack ---------------------------------------------------------------
export type Liveness = 'LIVE' | 'STALE' | 'WAITING_FOR_FIRST_POSITION' | 'ENDED';

export interface TrackingEta {
  remainingDistanceM: number;
  etaSeconds: number | null;
  source: DistanceSource;
  note: string;
}

/** GET /api/tracking/:sessionId and socket tracking:* payloads. */
export interface TrackingSessionView {
  id: string;
  pickupId: string;
  stage: 'TO_PICKUP' | 'TO_DESTINATION';
  status: 'ACTIVE' | 'ENDED' | string;
  liveness: Liveness;
  lastPosition: (LatLng & { accuracyM: number | null; recordedAt: string; ageSeconds: number | null }) | null;
  destination: LatLng | null;
  eta: TrackingEta | null;
  totalDistanceM: number;
  representativeName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  staleAfterSeconds: number;
}

export interface TrackingPoint extends LatLng {
  accuracyM: number | null;
  recordedAt: string;
}
