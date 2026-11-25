import { z } from 'zod';
import { latLng, optionalText, pagination, phone } from './common.js';

const postalCode = z.string().trim().regex(/^[0-9A-Za-z -]{3,12}$/, 'invalid postal code');
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'must be HH:MM (24h)');

export const donorUpdateSchema = z
  .object({
    businessName: z.string().trim().min(2).max(160).optional(),
    businessType: z.enum(['RESTAURANT', 'HOTEL', 'CAFETERIA', 'CATERER', 'FOOD_BUSINESS', 'OTHER']).optional(),
    licenseNumber: optionalText(60),
    contactPhone: phone.optional(),
    addressLine: optionalText(300),
    city: optionalText(100),
    state: optionalText(100),
    postalCode: postalCode.optional(),
    location: latLng.optional(),
    acceptsAssistanceRequests: z.boolean().optional(),
    pausedUntil: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).nullable().optional(),
    publicRecognitionConsent: z.boolean().optional(),
  })
  .strict();

export const ngoUpdateSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(160).optional(),
    registrationNumber: optionalText(60),
    contactPhone: phone.optional(),
    addressLine: optionalText(300),
    city: optionalText(100),
    state: optionalText(100),
    postalCode: postalCode.optional(),
    location: latLng.optional(),
    acceptsVeg: z.boolean().optional(),
    acceptsNonVeg: z.boolean().optional(),
    maxDailyCapacity: z.number().int().positive().max(100000).optional(),
    collectionRadiusKm: z.number().positive().max(100).optional(),
    beneficiariesCount: z.number().int().min(0).max(1000000).optional(),
    beneficiaryDescription: optionalText(1000),
    hasRefrigeration: z.boolean().optional(),
    defaultVehicleCapacity: z.number().int().positive().max(100000).nullable().optional(),
  })
  .strict()
  .refine((v) => !(v.acceptsVeg === false && v.acceptsNonVeg === false), 'An NGO must accept at least one dietary type.');

export const availabilitySchema = z.object({
  slots: z
    .array(
      z
        .object({ isoDayOfWeek: z.number().int().min(1).max(7), opensAt: time, closesAt: time })
        .refine((s) => s.closesAt > s.opensAt, 'closesAt must be after opensAt (split overnight windows into two slots)'),
    )
    .max(28),
});

export const categoryIdsSchema = z.object({ categoryIds: z.array(z.uuid()).max(20) });

export const documentUploadSchema = z.object({
  documentType: z.enum(['BUSINESS_LICENCE', 'FSSAI_LICENCE', 'NGO_REGISTRATION', 'TAX_EXEMPTION', 'ID_PROOF', 'OTHER']),
});

export const notificationPreferencesSchema = z
  .object({
    emailEnabled: z.boolean(),
    maxPerHour: z.number().int().min(1).max(100),
    maxDistanceKm: z.number().positive().max(100).nullable(),
    quietHoursStart: time.nullable(),
    quietHoursEnd: time.nullable(),
  })
  .refine((p) => (p.quietHoursStart === null) === (p.quietHoursEnd === null), 'quiet hours need both start and end');

export const notificationListSchema = pagination.extend({ unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') });

export const verificationDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
  notes: optionalText(1000),
});

export const documentReviewSchema = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']), notes: optionalText(1000) });

export const orgParams = z.object({ type: z.enum(['donor', 'ngo']).transform((t) => (t === 'donor' ? 'DONOR' : 'NGO') as 'DONOR' | 'NGO'), id: z.uuid() });

export const applicationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  type: z.enum(['DONOR', 'NGO']).optional(),
});

export const userListSchema = pagination.extend({
  role: z.enum(['DONOR', 'NGO', 'ADMIN']).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  search: z.string().trim().max(100).optional(),
});

export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: optionalText(500) });
