import { z } from 'zod';
import type { DisputeResolveBody, ManualPaymentInput, RewardAdjustmentInput, RewardRuleInput } from './types';

/*
 * Form schemas for the admin area. They mirror backend/src/validators
 * (profile.validators.ts, pickup.validators.ts) and settings.service.ts.
 * Numeric inputs are kept as strings in the forms and converted by the mappers,
 * so an empty input is "missing" rather than NaN.
 */

const isWholeNumber = (v: string) => /^-?\d+$/.test(v.trim());
const isDecimal = (v: string, places = 2) => new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(v.trim());

/** A whole-number field kept as a string: required, integer, within [min, max]. */
export function wholeNumberField(min: number, max: number, missing = 'Enter a number') {
  return z
    .string()
    .trim()
    .min(1, missing)
    .refine(isWholeNumber, 'Use a whole number')
    .refine((v) => Number(v) >= min && Number(v) <= max, `Enter a value from ${min} to ${max}`);
}

// --- Verification decisions ------------------------------------------------------
export const VERIFICATION_DECISIONS = ['APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

export const decisionSchema = z
  .object({ status: z.enum(VERIFICATION_DECISIONS), notes: z.string().trim().max(1000, 'Keep notes under 1,000 characters') })
  .superRefine((v, ctx) => {
    if (v.status === 'REJECTED' && v.notes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Explain why the application is rejected. The organisation sees this reason.' });
    }
  });
export type DecisionValues = z.infer<typeof decisionSchema>;

export const documentReviewSchema = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']), notes: z.string().trim().max(1000, 'Keep notes under 1,000 characters') });
export type DocumentReviewValues = z.infer<typeof documentReviewSchema>;

// --- Users ---------------------------------------------------------------------
export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().max(500, 'Keep the reason under 500 characters') });
export type UserStatusValues = z.infer<typeof userStatusSchema>;

// --- Disputes ------------------------------------------------------------------
export const DISPUTE_OUTCOMES = ['CONFIRM_QUANTITY', 'CANCEL_COLLECTION'] as const;

export interface DisputeResolveValues {
  outcome: (typeof DISPUTE_OUTCOMES)[number];
  resolvedQuantity: string;
  resolution: string;
}

/** CONFIRM_QUANTITY needs a whole quantity from 1 to the allocated quantity; CANCEL_COLLECTION takes none. */
export function disputeResolveSchema(allocatedQuantity: number) {
  return z
    .object({
      outcome: z.enum(DISPUTE_OUTCOMES),
      resolvedQuantity: z.string(),
      resolution: z.string().trim().min(3, 'Describe the resolution (at least 3 characters)').max(2000, 'Keep the resolution under 2,000 characters'),
    })
    .superRefine((v, ctx) => {
      if (v.outcome !== 'CONFIRM_QUANTITY') return;
      const raw = v.resolvedQuantity.trim();
      if (raw === '') {
        ctx.addIssue({ code: 'custom', path: ['resolvedQuantity'], message: 'Enter the quantity both sides should be recorded as handing over' });
      } else if (!isWholeNumber(raw)) {
        ctx.addIssue({ code: 'custom', path: ['resolvedQuantity'], message: 'Use a whole number' });
      } else if (Number(raw) < 1 || Number(raw) > allocatedQuantity) {
        ctx.addIssue({ code: 'custom', path: ['resolvedQuantity'], message: `Enter a quantity from 1 to ${allocatedQuantity} (the allocated quantity)` });
      }
    });
}

export function toDisputeResolveBody(v: DisputeResolveValues): DisputeResolveBody {
  if (v.outcome === 'CONFIRM_QUANTITY') return { outcome: v.outcome, resolvedQuantity: Number(v.resolvedQuantity.trim()), resolution: v.resolution.trim() };
  return { outcome: v.outcome, resolution: v.resolution.trim() };
}

// --- Billing -------------------------------------------------------------------
export interface ManualPaymentValues {
  amount: string;
  reference: string;
}

/** Offline payment: a positive amount (paise precision) that does not exceed the outstanding balance. */
export function manualPaymentSchema(outstanding: number) {
  return z.object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter the amount received')
      .refine((v) => isDecimal(v), 'Enter an amount in rupees, e.g. 300 or 300.50')
      .refine((v) => Number(v) > 0, 'The amount must be greater than zero')
      .refine((v) => Number(v) <= outstanding + 0.001, `The amount cannot exceed the outstanding ₹${outstanding.toFixed(2)}`),
    reference: z.string().trim().min(3, 'Enter the bank or cheque reference (at least 3 characters)').max(300, 'Keep the reference under 300 characters'),
  });
}

export function toManualPaymentInput(invoiceId: string, v: ManualPaymentValues): ManualPaymentInput {
  return { invoiceId, amount: Math.round(Number(v.amount.trim()) * 100) / 100, reference: v.reference.trim() };
}

export const feeRuleSchema = z.object({
  unit: z.enum(['MEALS', 'PACKETS', 'BOXES']),
  amountPerUnit: z
    .string()
    .trim()
    .min(1, 'Enter the fee per unit')
    .refine((v) => isDecimal(v), 'Enter an amount in rupees, e.g. 5 or 4.50')
    .refine((v) => Number(v) <= 100000, 'The fee cannot exceed ₹1,00,000 per unit'),
  description: z.string().trim().max(300, 'Keep the description under 300 characters'),
});
export type FeeRuleValues = z.infer<typeof feeRuleSchema>;

export const invoicePeriodSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an end date'),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'The end date cannot be before the start date' });
export type InvoicePeriodValues = z.infer<typeof invoicePeriodSchema>;

export const taxSettingSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1, 'Enter the tax name, e.g. GST').max(20, 'Use at most 20 characters'),
  rate_percent: z
    .string()
    .trim()
    .min(1, 'Enter the rate')
    .refine((v) => isDecimal(v), 'Enter a percentage, e.g. 18')
    .refine((v) => Number(v) <= 100, 'The rate cannot exceed 100%'),
});
export type TaxSettingValues = z.infer<typeof taxSettingSchema>;

// --- Rewards -------------------------------------------------------------------
export const rewardRuleSchema = z
  .object({
    unit: z.enum(['MEALS', 'PACKETS', 'BOXES']),
    basis: z.enum(['PER_UNIT', 'PER_ORDER']),
    points: wholeNumberField(1, 10000, 'Enter the points'),
    lifetimeThreshold: wholeNumberField(0, 10_000_000, 'Enter 0 to apply from the first unit'),
    description: z.string().trim().max(300, 'Keep the description under 300 characters'),
  })
  .refine((v) => v.basis !== 'PER_ORDER' || v.lifetimeThreshold.trim() === '0', { path: ['lifetimeThreshold'], message: 'Per-order rules apply from the first order (threshold 0)' });
export type RewardRuleValues = z.infer<typeof rewardRuleSchema>;

export function toRewardRuleInput(v: RewardRuleValues): RewardRuleInput {
  return {
    unit: v.unit,
    basis: v.basis,
    points: Number(v.points),
    lifetimeThreshold: Number(v.lifetimeThreshold),
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
  };
}

export const rewardAdjustSchema = z.object({
  donorId: z.string().min(1, 'Choose a donor'),
  points: wholeNumberField(-1_000_000, 1_000_000, 'Enter the points to add (or a negative number to deduct)').refine((v) => Number(v) !== 0, 'The adjustment cannot be zero'),
  reason: z.string().trim().min(3, 'Explain the adjustment (at least 3 characters)').max(300, 'Keep the reason under 300 characters'),
});
export type RewardAdjustValues = z.infer<typeof rewardAdjustSchema>;

export function toRewardAdjustmentInput(v: RewardAdjustValues): RewardAdjustmentInput {
  return { donorId: v.donorId, points: Number(v.points), reason: v.reason.trim() };
}

// --- Audit filters --------------------------------------------------------------
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
