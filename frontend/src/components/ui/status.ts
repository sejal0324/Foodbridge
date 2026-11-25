import type { BadgeTone } from './Badge';

/**
 * Status → colour and label for every backend lifecycle status (donations,
 * requests, allocations, assistance requests, offers, pickups, handovers,
 * verification, documents, disputes, tracking, billing). Unknown statuses fall
 * back to a neutral, humanised label.
 */
export const STATUS_STYLES: Record<string, { tone: BadgeTone; label: string }> = {
  // Donations
  DRAFT: { tone: 'neutral', label: 'Draft' },
  AVAILABLE: { tone: 'success', label: 'Available' },
  PARTIALLY_RESERVED: { tone: 'info', label: 'Partially reserved' },
  RESERVED: { tone: 'info', label: 'Reserved' },
  PICKUP_ASSIGNED: { tone: 'violet', label: 'Pickup assigned' },
  PICKED_UP: { tone: 'violet', label: 'Picked up' },
  IN_TRANSIT: { tone: 'violet', label: 'In transit' },
  COMPLETED: { tone: 'brand', label: 'Completed' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  DISPUTED: { tone: 'danger', label: 'Disputed' },
  // Donation requests
  PENDING: { tone: 'warning', label: 'Pending' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  WITHDRAWN: { tone: 'neutral', label: 'Withdrawn' },
  // Assistance requests
  OPEN: { tone: 'success', label: 'Open' },
  PARTIALLY_FULFILLED: { tone: 'info', label: 'Partially fulfilled' },
  FULFILLED: { tone: 'brand', label: 'Fulfilled' },
  // Offers
  PROPOSED: { tone: 'warning', label: 'Proposed' },
  ACCEPTED: { tone: 'success', label: 'Accepted' },
  // Pickups
  ASSIGNED: { tone: 'info', label: 'Assigned' },
  EN_ROUTE: { tone: 'violet', label: 'En route' },
  VERIFIED: { tone: 'success', label: 'Verified' },
  HANDED_OVER: { tone: 'brand', label: 'Handed over' },
  DELIVERED: { tone: 'brand', label: 'Delivered' },
  FAILED: { tone: 'danger', label: 'Failed' },
  // Handover
  PENDING_DONOR: { tone: 'warning', label: 'Awaiting donor' },
  PENDING_NGO: { tone: 'warning', label: 'Awaiting NGO' },
  CONFIRMED: { tone: 'brand', label: 'Confirmed' },
  // Verification and accounts
  SUSPENDED: { tone: 'danger', label: 'Suspended' },
  INVITED: { tone: 'info', label: 'Invited' },
  ACTIVE: { tone: 'success', label: 'Active' },
  INACTIVE: { tone: 'neutral', label: 'Inactive' },
  REVOKED: { tone: 'danger', label: 'Revoked' },
  DEACTIVATED: { tone: 'neutral', label: 'Deactivated' },
  // Disputes
  UNDER_REVIEW: { tone: 'warning', label: 'Under review' },
  RESOLVED: { tone: 'brand', label: 'Resolved' },
  // Tracking
  ENDED: { tone: 'neutral', label: 'Ended' },
  LIVE: { tone: 'success', label: 'Live' },
  STALE: { tone: 'warning', label: 'Stale' },
  WAITING_FOR_FIRST_POSITION: { tone: 'info', label: 'Waiting for GPS' },
  // Billing
  ISSUED: { tone: 'info', label: 'Issued' },
  PAID: { tone: 'brand', label: 'Paid' },
  PARTIALLY_PAID: { tone: 'info', label: 'Partially paid' },
  UNPAID: { tone: 'warning', label: 'Unpaid' },
  OVERDUE: { tone: 'danger', label: 'Overdue' },
  VOID: { tone: 'neutral', label: 'Void' },
  CREATED: { tone: 'neutral', label: 'Created' },
  CAPTURED: { tone: 'brand', label: 'Captured' },
  REFUNDED: { tone: 'neutral', label: 'Refunded' },
  // Jobs / generic
  QUEUED: { tone: 'neutral', label: 'Queued' },
  RUNNING: { tone: 'info', label: 'Running' },
  SUCCEEDED: { tone: 'brand', label: 'Succeeded' },
  DEAD: { tone: 'danger', label: 'Dead' },
  SENT: { tone: 'success', label: 'Sent' },
  // Collection plans
  PROPOSED_PLAN: { tone: 'warning', label: 'Proposed' },
};

export function statusStyle(status: string | null | undefined): { tone: BadgeTone; label: string } {
  if (!status) return { tone: 'neutral', label: 'Unknown' };
  const known = STATUS_STYLES[status];
  if (known) return known;
  const s = status.replace(/_/g, ' ').toLowerCase();
  return { tone: 'neutral', label: s.charAt(0).toUpperCase() + s.slice(1) };
}
