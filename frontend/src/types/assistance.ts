import type { DistanceSource, LatLng } from './api';
import type { DietaryRequirement, DietaryType, NamedRef, StorageType, Unit, Urgency } from './common';
import type { FoodCategoryRef } from './donations';

export type AssistanceRequestStatus = 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
export type OfferStatus = 'PROPOSED' | 'ACCEPTED' | 'RESERVED' | 'PICKUP_ASSIGNED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface AssistanceRequest {
  id: string;
  ngo: NamedRef;
  category: FoodCategoryRef;
  dietaryRequirement: DietaryRequirement;
  quantityRequired: number;
  quantityCommitted: number;
  quantityRemaining: number;
  quantityReceived: number;
  unit: Unit;
  neededFrom: string;
  neededUntil: string;
  location: LatLng;
  address: string;
  urgency: Urgency;
  beneficiariesCount: number;
  reason: string | null;
  additionalRequirements: string | null;
  status: AssistanceRequestStatus;
  version: number;
  createdAt: string;
  distanceKm?: number;
  distanceSource?: DistanceSource;
}

export interface Offer {
  id: string;
  assistanceRequestId: string;
  donor: NamedRef;
  offeredQuantity: number;
  acceptedQuantity: number | null;
  confirmedQuantity: number | null;
  foodName: string;
  dietaryType: DietaryType;
  pickupAvailableFrom: string;
  pickupDeadline: string;
  location: LatLng;
  address: string;
  notes: string | null;
  readyNow: boolean;
  status: OfferStatus;
  donationId: string | null;
  allocationId: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/** GET /api/offers/mine item. */
export interface MyOffer extends Offer {
  ngoName: string;
  unit: Unit;
  neededFrom: string;
  requestStatus: AssistanceRequestStatus;
}

/** GET /api/assistance-requests/:id (offers are filtered to the viewer's own for donors). */
export interface AssistanceRequestDetail extends AssistanceRequest {
  offers: Offer[];
}

export interface OfferCreateInput {
  quantity: number;
  foodName: string;
  dietaryType: DietaryType;
  pickupAvailableFrom: string;
  pickupDeadline: string;
  location?: LatLng;
  address?: string;
  notes?: string;
  readyFood?: { preparedAt: string; storageType: StorageType; safetyConfirmed: true };
}

export interface OfferConfirmInput {
  confirmedQuantity: number;
  preparedAt: string;
  storageType: StorageType;
  safetyConfirmed: true;
  storageNotes?: string;
}

export interface AssistanceCreateInput {
  categoryId: string;
  dietaryRequirement: DietaryRequirement;
  quantityRequired: number;
  unit: Unit;
  neededFrom: string;
  neededUntil: string;
  location?: LatLng;
  address?: string;
  urgency: Urgency;
  beneficiariesCount: number;
  reason?: string;
  additionalRequirements?: string;
}
