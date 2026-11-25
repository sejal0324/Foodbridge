import { conflict } from '../utils/errors.js';

/**
 * Allowed lifecycle transitions (documented in docs/DATABASE_DESIGN.md §7).
 * Every status change in the backend goes through `assertTransition`.
 */
export const DONATION_TRANSITIONS = {
  DRAFT: ['AVAILABLE', 'CANCELLED'],
  AVAILABLE: ['PARTIALLY_RESERVED', 'RESERVED', 'EXPIRED', 'CANCELLED'],
  PARTIALLY_RESERVED: ['AVAILABLE', 'RESERVED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'DISPUTED'],
  RESERVED: ['AVAILABLE', 'PARTIALLY_RESERVED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'DISPUTED'],
  PICKUP_ASSIGNED: ['RESERVED', 'PARTIALLY_RESERVED', 'AVAILABLE', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'DISPUTED'],
  PICKED_UP: ['IN_TRANSIT', 'COMPLETED', 'DISPUTED', 'PICKUP_ASSIGNED'],
  IN_TRANSIT: ['COMPLETED', 'DISPUTED', 'PICKED_UP', 'PICKUP_ASSIGNED'],
  DISPUTED: ['PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'RESERVED', 'PICKUP_ASSIGNED'],
  COMPLETED: [],
  EXPIRED: [],
  CANCELLED: [],
} as const satisfies Record<string, readonly string[]>;
export type DonationStatus = keyof typeof DONATION_TRANSITIONS;

export const REQUEST_TRANSITIONS = {
  OPEN: ['PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'EXPIRED'],
  PARTIALLY_FULFILLED: ['OPEN', 'FULFILLED', 'CANCELLED', 'EXPIRED'],
  FULFILLED: ['OPEN', 'PARTIALLY_FULFILLED', 'CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
} as const satisfies Record<string, readonly string[]>;
export type AssistanceRequestStatus = keyof typeof REQUEST_TRANSITIONS;

export const OFFER_TRANSITIONS = {
  PROPOSED: ['ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['RESERVED', 'CANCELLED', 'EXPIRED'],
  RESERVED: ['PICKUP_ASSIGNED', 'COMPLETED', 'CANCELLED'],
  PICKUP_ASSIGNED: ['RESERVED', 'COMPLETED', 'CANCELLED'],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
} as const satisfies Record<string, readonly string[]>;
export type OfferStatus = keyof typeof OFFER_TRANSITIONS;

export const ALLOCATION_TRANSITIONS = {
  RESERVED: ['PICKUP_ASSIGNED', 'CANCELLED', 'EXPIRED'],
  PICKUP_ASSIGNED: ['RESERVED', 'PICKED_UP', 'DISPUTED', 'CANCELLED', 'EXPIRED'],
  PICKED_UP: ['IN_TRANSIT', 'COMPLETED', 'DISPUTED'],
  IN_TRANSIT: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
} as const satisfies Record<string, readonly string[]>;
export type AllocationStatus = keyof typeof ALLOCATION_TRANSITIONS;

export const PICKUP_TRANSITIONS = {
  ASSIGNED: ['EN_ROUTE', 'VERIFIED', 'CANCELLED', 'FAILED'],
  EN_ROUTE: ['VERIFIED', 'CANCELLED', 'FAILED'],
  VERIFIED: ['HANDED_OVER', 'DISPUTED', 'CANCELLED', 'FAILED'],
  HANDED_OVER: ['IN_TRANSIT', 'DELIVERED'],
  IN_TRANSIT: ['DELIVERED'],
  DISPUTED: ['HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
} as const satisfies Record<string, readonly string[]>;
export type PickupStatus = keyof typeof PICKUP_TRANSITIONS;

const MACHINES = {
  donation: DONATION_TRANSITIONS,
  assistance_request: REQUEST_TRANSITIONS,
  offer: OFFER_TRANSITIONS,
  allocation: ALLOCATION_TRANSITIONS,
  pickup: PICKUP_TRANSITIONS,
} as const;

export function canTransition(kind: keyof typeof MACHINES, from: string, to: string): boolean {
  const allowed = (MACHINES[kind] as Record<string, readonly string[]>)[from];
  return Boolean(allowed?.includes(to));
}

/** Throws 409 INVALID_STATE_TRANSITION for transitions the lifecycle does not allow. */
export function assertTransition(kind: keyof typeof MACHINES, from: string, to: string): void {
  if (from === to) return;
  if (!canTransition(kind, from, to)) {
    throw conflict(`Cannot change ${kind.replace('_', ' ')} status from ${from} to ${to}.`, 'INVALID_STATE_TRANSITION', { from, to });
  }
}

/** Reservation-phase donation status from quantities. */
export function donationStatusFromQuantities(quantity: number, reserved: number): 'AVAILABLE' | 'PARTIALLY_RESERVED' | 'RESERVED' {
  if (reserved <= 0) return 'AVAILABLE';
  return reserved >= quantity ? 'RESERVED' : 'PARTIALLY_RESERVED';
}

/** Assistance request status from committed quantity. */
export function requestStatusFromQuantities(required: number, committed: number): 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' {
  if (committed <= 0) return 'OPEN';
  return committed >= required ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
}
