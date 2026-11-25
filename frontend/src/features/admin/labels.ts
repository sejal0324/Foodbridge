import type { BadgeTone } from '@/components/ui';

export const ORG_TYPE_LABEL = { DONOR: 'Donor', NGO: 'NGO' } as const;

export const ROLE_LABELS: Record<string, string> = { DONOR: 'Donor', NGO: 'NGO', ADMIN: 'Admin' };

export const VERIFICATION_METHOD_LABELS: Record<string, string> = { QR: 'QR pass', IDENTITY_CHECK: 'ID check' };

export const DONATION_STATUS_OPTIONS = [
  'DRAFT',
  'AVAILABLE',
  'PARTIALLY_RESERVED',
  'RESERVED',
  'PICKUP_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED',
] as const;

/** Donations an admin may still cancel (the backend also refuses once any food has been handed over). */
export const CANCELLABLE_DONATION_STATUSES = new Set(['DRAFT', 'AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED']);

export const ASSISTANCE_STATUS_OPTIONS = ['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'EXPIRED'] as const;
export const CANCELLABLE_ASSISTANCE_STATUSES = new Set(['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED']);

export const PICKUP_STATUS_OPTIONS = ['ASSIGNED', 'EN_ROUTE', 'VERIFIED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'CANCELLED', 'FAILED'] as const;
/** Pickups that should have happened before the donation's pickup deadline. */
export const PRE_HANDOVER_PICKUP_STATUSES = new Set(['ASSIGNED', 'EN_ROUTE', 'VERIFIED']);

export const AUDIT_ENTITY_TYPES = [
  'user',
  'session',
  'donor',
  'ngo',
  'representative',
  'verification_document',
  'donation',
  'donation_request',
  'allocation',
  'assistance_request',
  'assistance_offer',
  'pickup',
  'handover',
  'tracking_session',
  'dispute',
  'collection_plan',
  'reward_rule',
  'reward_transaction',
  'impact_certificate',
  'service_fee_rule',
  'ngo_billing',
  'invoice',
  'payment',
  'platform_setting',
  'job',
] as const;

/** Honest descriptions of the integration states reported by GET /health/ready. */
export function integrationInfo(name: 'email' | 'maps' | 'payments', value: string): { label: string; detail: string; tone: BadgeTone } {
  switch (name) {
    case 'email':
      if (value === 'log') return { label: 'Development log only', detail: 'Emails are written to the server log and are not delivered to anyone. Configure an email provider before production.', tone: 'warning' };
      if (value === 'not_configured') return { label: 'Not configured', detail: 'No email provider is configured, so no emails are sent.', tone: 'danger' };
      return { label: `Configured (${value})`, detail: 'Emails are delivered through this provider.', tone: 'success' };
    case 'maps':
      if (value === 'configured') return { label: 'Google Maps configured', detail: 'Road distances and Google geocoding are available on the server.', tone: 'success' };
      return { label: 'Not configured', detail: 'Distances are straight-line estimates and address search uses OpenStreetMap.', tone: 'neutral' };
    case 'payments':
      if (value === 'razorpay') return { label: 'Razorpay', detail: 'NGOs can pay invoices online.', tone: 'success' };
      return { label: 'Not configured', detail: 'Online payment is unavailable. NGOs pay offline and admins record the payments manually.', tone: 'neutral' };
  }
}
