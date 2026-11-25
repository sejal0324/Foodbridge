/* Test fixtures for the NGO area (imported by *.test.tsx only). */
import type { FeeEstimate, Me, Offer, PickupDetail, TrackingSessionView, Unit } from '@/types';

export const ngoOwner: Me = {
  id: 'u-ngo-owner',
  email: 'helping.hands@demo.foodbridge.local',
  fullName: 'Meera Joshi',
  phone: '+919800000201',
  role: 'NGO',
  accountStatus: 'ACTIVE',
  adminLevel: null,
  organization: { type: 'NGO', id: 'ngo-1', name: 'Helping Hands Foundation', verificationStatus: 'APPROVED' },
  representative: { id: 'rep-owner', ngoId: 'ngo-1', ngoName: 'Helping Hands Foundation', status: 'ACTIVE' },
};

export const representativeOnly: Me = {
  id: 'u-rep',
  email: 'ravi.rep@example.org',
  fullName: 'Ravi Patil',
  phone: '+919800000999',
  role: 'NGO',
  accountStatus: 'ACTIVE',
  adminLevel: null,
  organization: null,
  representative: { id: 'rep-2', ngoId: 'ngo-1', ngoName: 'Helping Hands Foundation', status: 'ACTIVE' },
};

export function feeFor(unit: Unit | string, quantity: number, unitAmount = 5): FeeEstimate {
  return {
    unit: unit as Unit,
    quantity,
    unitAmount,
    baseAmount: unitAmount * quantity,
    tax: { applied: false, name: null, ratePercent: 0, amount: 0 },
    totalAmount: unitAmount * quantity,
    currency: 'INR',
    isEstimate: true,
    note: 'This is an estimate; the final fee uses the quantity both sides confirm at handover.',
  };
}

export const offer: Offer = {
  id: 'offer-1',
  assistanceRequestId: 'ar-1',
  donor: { id: 'donor-1', name: 'Hotel Sahyadri' },
  offeredQuantity: 60,
  acceptedQuantity: null,
  confirmedQuantity: null,
  foodName: 'Veg pulao',
  dietaryType: 'VEG',
  pickupAvailableFrom: '2026-11-04T04:30:00.000Z',
  pickupDeadline: '2026-11-04T07:00:00.000Z',
  location: { lat: 18.559, lng: 73.7868 },
  address: 'Baner Road, Baner, Pune',
  notes: null,
  readyNow: false,
  status: 'PROPOSED',
  donationId: null,
  allocationId: null,
  rejectionReason: null,
  cancelReason: null,
  createdAt: '2026-11-03T11:53:05.063Z',
};

export const pickup: PickupDetail = {
  id: 'pickup-1',
  allocationId: 'alloc-1',
  status: 'ASSIGNED',
  viewer: 'REPRESENTATIVE',
  donation: {
    id: 'don-1',
    foodName: 'Veg biryani with raita',
    unit: 'MEALS',
    dietaryType: 'VEG',
    quantity: 50,
    pickupDeadline: '2099-01-01T10:00:00.000Z',
    address: 'Wakad Main Road, Wakad, Pune',
    location: { lat: 18.5987, lng: 73.7623 },
  },
  donor: { id: 'donor-2', name: 'Spice Garden Restaurant' },
  ngo: { id: 'ngo-1', name: 'Helping Hands Foundation' },
  representative: { id: 'rep-owner', name: 'Meera Joshi', phone: '+919800000201', idDocumentType: 'AADHAAR', idDocumentLast4: '0201', hasPhoto: false, status: 'ACTIVE' },
  scheduledPickupAt: null,
  destination: null,
  checks: { qrVerifiedAt: null, identityConfirmedAt: null },
  handedOverAt: null,
  deliveredAt: null,
  cancelReason: null,
  allocationStatus: 'PICKUP_ASSIGNED',
  createdAt: '2026-11-03T12:00:00.000Z',
  handover: null,
  delivery: null,
  trackingSessions: [],
};

export function sessionView(id: string, overrides: Partial<TrackingSessionView> = {}): TrackingSessionView {
  return {
    id,
    pickupId: pickup.id,
    stage: 'TO_PICKUP',
    status: 'ACTIVE',
    liveness: 'WAITING_FOR_FIRST_POSITION',
    lastPosition: null,
    destination: pickup.donation.location,
    eta: null,
    totalDistanceM: 0,
    representativeName: 'Meera Joshi',
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: null,
    staleAfterSeconds: 60,
    ...overrides,
  };
}
