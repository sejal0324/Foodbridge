import type { LatLng } from './api';
import type { DietaryType, NamedRef, StorageType, Unit } from './common';

export type DonationStatus =
  | 'DRAFT'
  | 'AVAILABLE'
  | 'PARTIALLY_RESERVED'
  | 'RESERVED'
  | 'PICKUP_ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DISPUTED';

export type DonationRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED' | 'EXPIRED';

export type AllocationStatus = 'RESERVED' | 'PICKUP_ASSIGNED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DISPUTED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface FoodCategoryRef {
  id: string;
  code: string;
  name: string;
}

export interface Donation {
  id: string;
  donor: NamedRef;
  origin: 'DIRECT_LISTING' | 'ASSISTANCE_OFFER' | string;
  foodName: string;
  category: FoodCategoryRef;
  dietaryType: DietaryType;
  quantity: number;
  unit: Unit;
  reservedQuantity: number;
  availableQuantity: number;
  expiredQuantity: number;
  preparedAt: string;
  bestBefore: string | null;
  storageType: StorageType;
  storageNotes: string | null;
  pickupAvailableFrom: string;
  pickupDeadline: string;
  location: LatLng | null;
  address: string;
  description: string | null;
  safetyConfirmed: boolean;
  status: DonationStatus;
  cancelledReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  distanceKm?: number;
  distanceSource?: string;
}

export interface DonationHistoryEntry {
  from: DonationStatus | null;
  to: DonationStatus;
  reason: string | null;
  at: string;
}

export interface DonationRequestSummary {
  id: string;
  ngo: NamedRef;
  requestedQuantity: number;
  approvedQuantity: number | null;
  message: string | null;
  status: DonationRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface DonationAllocationSummary {
  id: string;
  ngo: NamedRef;
  quantity: number;
  status: AllocationStatus;
  source: 'DONATION_REQUEST' | 'ASSISTANCE_OFFER' | string;
  handedOverQuantity: number | null;
  createdAt: string;
}

/** GET /api/donations/:id */
export interface DonationDetail extends Donation {
  warnings: string[];
  history: DonationHistoryEntry[];
  requests: DonationRequestSummary[];
  allocations: DonationAllocationSummary[];
}

/** POST /api/donations response. */
export interface CreatedDonation extends Donation {
  warnings: string[];
}

/** GET /api/requests item. */
export interface DonationRequest {
  id: string;
  donation: {
    id: string;
    foodName: string;
    unit: Unit;
    dietaryType: DietaryType;
    pickupDeadline: string;
    status: DonationStatus;
    availableQuantity: number;
    donorName: string;
  };
  ngo: NamedRef & { beneficiariesCount: number };
  requestedQuantity: number;
  approvedQuantity: number | null;
  message: string | null;
  status: DonationRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}

/** GET /api/allocations item. */
export interface Allocation {
  id: string;
  donationId: string;
  ngo: NamedRef;
  donor: NamedRef;
  foodName: string;
  unit: Unit;
  dietaryType: DietaryType;
  quantity: number;
  source: string;
  status: AllocationStatus;
  handedOverQuantity: number | null;
  pickupDeadline: string;
  address: string;
  pickup: { id: string; status: string } | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface DonationCreateInput {
  foodName: string;
  categoryId: string;
  dietaryType: DietaryType;
  quantity: number;
  unit: Unit;
  preparedAt: string;
  bestBefore?: string;
  storageType: StorageType;
  storageNotes?: string;
  pickupAvailableFrom?: string;
  pickupDeadline: string;
  location?: LatLng;
  address?: string;
  description?: string;
  safetyConfirmed: boolean;
  publish: boolean;
}

export interface DonationUpdateInput {
  version: number;
  foodName?: string;
  quantity?: number;
  storageType?: StorageType;
  storageNotes?: string;
  pickupAvailableFrom?: string;
  pickupDeadline?: string;
  description?: string;
  safetyConfirmed?: boolean;
  publish?: boolean;
}
