import { z } from 'zod';
import { isoDate, isoDateTime, latLng, optionalText, pagination, phone, quantity, unit } from './common.js';

export const representativeCreateSchema = z
  .object({
    self: z.boolean().default(false),
    fullName: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    phone,
    idDocumentType: z.enum(['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID', 'OTHER']),
    idDocumentLast4: z.string().trim().regex(/^[0-9A-Za-z]{4}$/, 'exactly the last 4 characters of the ID'),
  })
  .strict();
export const representativeStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'REVOKED']) });

export const assignSchema = z
  .object({
    allocationId: z.uuid(),
    representativeId: z.uuid(),
    scheduledPickupAt: isoDateTime.optional(),
    destination: z.object({ location: latLng, address: z.string().trim().min(5).max(300) }).optional(),
  })
  .strict();
export const pickupIdSchema = z.object({ pickupId: z.uuid() }).strict();
export const verifyQrSchema = z.object({ token: z.string().trim().min(10).max(200) }).strict();
export const handoverSchema = z.object({ pickupId: z.uuid(), quantity, notes: optionalText(1000) }).strict();
export const failureSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const deliverySchema = z
  .object({ deliveredQuantity: z.number().int().min(0).max(100000), beneficiariesServed: z.number().int().min(0).max(1000000).optional(), notes: optionalText(1000), location: latLng.optional() })
  .strict();
export const pickupListSchema = z.object({ status: z.string().regex(/^[A-Z_]+$/).optional(), active: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });
export const disputeResolveSchema = z
  .object({ outcome: z.enum(['CONFIRM_QUANTITY', 'CANCEL_COLLECTION']), resolvedQuantity: quantity.optional(), resolution: z.string().trim().min(3).max(2000) })
  .strict()
  .refine((v) => v.outcome !== 'CONFIRM_QUANTITY' || v.resolvedQuantity !== undefined, { message: 'resolvedQuantity is required to confirm a quantity', path: ['resolvedQuantity'] });

export const trackingStartSchema = z.object({ pickupId: z.uuid(), stage: z.enum(['TO_PICKUP', 'TO_DESTINATION']), consent: z.literal(true) }).strict();
export const locationSchema = z
  .object({
    sessionId: z.uuid(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100000).optional(),
    heading: z.number().min(0).max(359.99).optional(),
    speedMps: z.number().min(0).max(200).optional(),
    recordedAt: isoDateTime,
  })
  .strict();
export const trackingStopSchema = z.object({ sessionId: z.uuid(), reason: optionalText(200) }).strict();
export const trackingEventSchema = z
  .object({
    sessionId: z.uuid().optional(),
    pickupId: z.uuid().optional(),
    type: z.enum(['PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'DISCONNECTED', 'RECONNECTED']),
    detail: optionalText(300),
  })
  .strict();

export const certificateSchema = z.object({ periodStart: isoDate, periodEnd: isoDate }).strict();
export const rewardRuleSchema = z
  .object({ unit, basis: z.enum(['PER_UNIT', 'PER_ORDER']), points: z.number().int().positive().max(10000), lifetimeThreshold: z.number().int().min(0).max(10_000_000).default(0), description: optionalText(300) })
  .strict();
export const rewardAdjustSchema = z.object({ donorId: z.uuid(), points: z.number().int().min(-1_000_000).max(1_000_000), reason: z.string().trim().min(3).max(300) }).strict();
export const feeRuleSchema = z.object({ unit, amountPerUnit: z.number().min(0).max(100000), description: optionalText(300) }).strict();
export const invoiceGenerateSchema = z.object({ periodStart: isoDate, periodEnd: isoDate }).strict();
export const manualPaymentSchema = z.object({ invoiceId: z.uuid(), amount: z.number().positive().max(10_000_000), reference: z.string().trim().min(3).max(300) }).strict();
export const paymentCreateSchema = z.object({ invoiceId: z.uuid() }).strict();
export const paymentVerifySchema = z.object({ orderId: z.string().min(5).max(100), paymentId: z.string().min(5).max(100), signature: z.string().min(10).max(200) }).strict();
export const leaderboardSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
export const historySchema = pagination;
