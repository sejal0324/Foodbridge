import { z } from 'zod';
import {
  dietaryRequirement,
  dietaryType,
  isoDateTime,
  latLng,
  optionalText,
  pagination,
  quantity,
  storageType,
  unit,
  urgency,
} from './common.js';

export const donationCreateSchema = z
  .object({
    foodName: z.string().trim().min(2).max(120),
    categoryId: z.uuid(),
    dietaryType,
    quantity,
    unit,
    preparedAt: isoDateTime,
    bestBefore: isoDateTime.optional(),
    storageType,
    storageNotes: optionalText(500),
    pickupAvailableFrom: isoDateTime.optional(),
    pickupDeadline: isoDateTime,
    location: latLng.optional(),
    address: z.string().trim().min(5).max(300).optional(),
    description: optionalText(2000),
    /** The donor confirms the food is fit to donate. Required to publish; FoodBridge does not certify food safety. */
    safetyConfirmed: z.boolean(),
    publish: z.boolean().default(true),
  })
  .strict();

export const donationUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    foodName: z.string().trim().min(2).max(120).optional(),
    quantity: quantity.optional(),
    storageType: storageType.optional(),
    storageNotes: optionalText(500),
    pickupAvailableFrom: isoDateTime.optional(),
    pickupDeadline: isoDateTime.optional(),
    description: optionalText(2000),
    safetyConfirmed: z.boolean().optional(),
    publish: z.boolean().optional(),
  })
  .strict();

export const donationListSchema = pagination.extend({
  status: z.string().regex(/^[A-Z_]+(,[A-Z_]+)*$/).optional(),
  categoryId: z.uuid().optional(),
  dietaryType: dietaryType.optional(),
  maxDistanceKm: z.coerce.number().positive().max(100).optional(),
  sort: z.enum(['distance', 'deadline', 'newest']).default('newest'),
  scope: z.enum(['mine', 'marketplace', 'all']).optional(),
});

export const cancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const donationRequestCreateSchema = z.object({ quantity, message: optionalText(1000) }).strict();
export const requestApproveSchema = z.object({ quantity: quantity.optional() }).strict();
export const requestRejectSchema = z.object({ reason: optionalText(500) }).strict();
export const requestListSchema = pagination.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED', 'EXPIRED']).optional(),
  donationId: z.uuid().optional(),
});

export const assistanceCreateSchema = z
  .object({
    categoryId: z.uuid(),
    dietaryRequirement,
    quantityRequired: quantity,
    unit,
    neededFrom: isoDateTime,
    neededUntil: isoDateTime,
    location: latLng.optional(),
    address: z.string().trim().min(5).max(300).optional(),
    urgency,
    beneficiariesCount: z.number().int().positive().max(1000000),
    reason: optionalText(1000),
    additionalRequirements: optionalText(1000),
  })
  .strict()
  .refine((v) => v.neededUntil > v.neededFrom, { message: 'neededUntil must be after neededFrom', path: ['neededUntil'] });

export const assistanceUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    quantityRequired: quantity.optional(),
    neededFrom: isoDateTime.optional(),
    neededUntil: isoDateTime.optional(),
    urgency: urgency.optional(),
    beneficiariesCount: z.number().int().positive().max(1000000).optional(),
    reason: optionalText(1000),
    additionalRequirements: optionalText(1000),
  })
  .strict();

export const assistanceListSchema = pagination.extend({
  status: z.string().regex(/^[A-Z_]+(,[A-Z_]+)*$/).optional(),
  scope: z.enum(['mine', 'open', 'all']).optional(),
  maxDistanceKm: z.coerce.number().positive().max(100).optional(),
});

const readyFood = z
  .object({
    preparedAt: isoDateTime,
    storageType,
    safetyConfirmed: z.literal(true),
  })
  .strict();

export const offerCreateSchema = z
  .object({
    quantity,
    foodName: z.string().trim().min(2).max(120),
    dietaryType,
    pickupAvailableFrom: isoDateTime,
    pickupDeadline: isoDateTime,
    location: latLng.optional(),
    address: z.string().trim().min(5).max(300).optional(),
    notes: optionalText(1000),
    /** Supply when the food already exists, so acceptance reserves it immediately. */
    readyFood: readyFood.optional(),
  })
  .strict()
  .refine((v) => v.pickupDeadline > v.pickupAvailableFrom, { message: 'pickupDeadline must be after pickupAvailableFrom', path: ['pickupDeadline'] });

export const offerAcceptSchema = z.object({ quantity: quantity.optional() }).strict();
export const offerConfirmSchema = z
  .object({
    confirmedQuantity: quantity,
    preparedAt: isoDateTime,
    storageType,
    safetyConfirmed: z.literal(true),
    storageNotes: optionalText(500),
  })
  .strict();
export const offerRespondSchema = z.object({ response: z.enum(['DECLINED', 'UNAVAILABLE']), note: optionalText(500) }).strict();
export const feeEstimateSchema = z.object({ unit, quantity });
