import type { PickupDetail } from '@/types';

/**
 * Donor-side handover verification, derived from the server's pickup state so
 * a reload (or another device) resumes at the right step:
 *
 *   SCAN → IDENTITY → HANDOVER → OUTCOME (WAITING | CONFIRMED | DISPUTED)
 *   CLOSED when the pickup was cancelled or failed.
 */
export type VerificationStep = 'SCAN' | 'IDENTITY' | 'HANDOVER' | 'OUTCOME' | 'CLOSED';
export type HandoverOutcome = 'WAITING' | 'CONFIRMED' | 'DISPUTED';

export interface StepState {
  step: VerificationStep;
  outcome?: HandoverOutcome;
}

type PickupState = Pick<PickupDetail, 'status' | 'checks' | 'handover'>;

export function deriveVerificationStep(p: PickupState | null | undefined): StepState {
  if (!p) return { step: 'SCAN' };
  if (p.status === 'CANCELLED' || p.status === 'FAILED') return { step: 'CLOSED' };
  if (p.status === 'DISPUTED' || p.handover?.status === 'DISPUTED') return { step: 'OUTCOME', outcome: 'DISPUTED' };
  if (p.status === 'HANDED_OVER' || p.status === 'IN_TRANSIT' || p.status === 'DELIVERED' || p.handover?.status === 'CONFIRMED') {
    return { step: 'OUTCOME', outcome: 'CONFIRMED' };
  }
  if (p.status === 'VERIFIED') {
    if (p.handover?.donorConfirmedQuantity !== null && p.handover?.donorConfirmedQuantity !== undefined) return { step: 'OUTCOME', outcome: 'WAITING' };
    return { step: 'HANDOVER' };
  }
  if (!p.checks.qrVerifiedAt) return { step: 'SCAN' };
  return { step: 'IDENTITY' };
}

export const VERIFICATION_STEPS: { step: Exclude<VerificationStep, 'CLOSED'>; label: string }[] = [
  { step: 'SCAN', label: 'Scan pass' },
  { step: 'IDENTITY', label: 'Check ID' },
  { step: 'HANDOVER', label: 'Confirm quantity' },
  { step: 'OUTCOME', label: 'Result' },
];

export interface RejectionCopy {
  title: string;
  body: string;
  /** Tell the donor not to hand over food. */
  stop: boolean;
}

/** Messages for `details.reason` of 422 QR_REJECTED. */
export const QR_REJECTION_COPY: Record<string, RejectionCopy> = {
  TOKEN_EXPIRED: { title: 'This pass has expired', body: 'Passes are valid for a short time. Ask the representative to generate a new pass in their app and scan again.', stop: false },
  TOKEN_REVOKED: { title: 'This pass was revoked', body: 'A newer pass replaced it, or the pickup was changed. Ask the representative to open a fresh pass.', stop: false },
  TOKEN_CONSUMED: { title: 'This pass was already used', body: 'Each pass works once. If you did not scan it yourself, do not hand over food and contact the NGO.', stop: true },
  WRONG_DONOR: { title: 'This pass is for a different donor', body: 'The pass does not belong to a pickup from your organisation. Do not hand over food.', stop: true },
  REPRESENTATIVE_INACTIVE: { title: 'Representative is no longer authorised', body: 'The NGO has deactivated this representative. Do not hand over food; contact the NGO.', stop: true },
  TOKEN_NOT_FOUND: { title: 'Not a valid FoodBridge pass', body: 'The code was not recognised. Check that you scanned the FoodBridge pickup pass, or type the code exactly.', stop: false },
  PICKUP_NOT_ACTIVE: { title: 'This pickup cannot be verified', body: 'The pickup is no longer waiting for verification (it may be cancelled or already completed).', stop: true },
};

export function qrRejectionCopy(reason: string | undefined, fallbackMessage: string): RejectionCopy {
  return (reason && QR_REJECTION_COPY[reason]) || { title: 'The pass was rejected', body: fallbackMessage, stop: true };
}
