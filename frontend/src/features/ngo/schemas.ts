import { z } from 'zod';
import { UNITS, URGENCIES, type AssistanceCreateInput, type AssistanceRequest } from '@/types';
import { fromIstInputValue, istInputToMillis, toIstInputValue } from '@/utils/format';
import { isWithinIndiaBounds } from '@/utils/india';
import type { AssistanceUpdateInput } from './api';
import { ID_DOCUMENT_TYPES } from './types';

/*
 * Client-side rules mirror backend/src/validators/*.ts; the backend stays the authority.
 */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a date and time');
const MIN_WINDOW_END_MS = 15 * 60_000;
const wholeNumber = (label: string, max: number) =>
  z.number({ error: `Enter the ${label}` }).int('Use a whole number').min(1, 'Enter at least 1').max(max, `At most ${max.toLocaleString('en-IN')}`);

// --- Assistance request ------------------------------------------------------------------
const timeWindow = z.object({ neededFrom: localDateTime, neededUntil: localDateTime });
const windowIsComplete = (payload: { value: unknown }) => timeWindow.safeParse(payload.value).success;

export const assistanceFormSchema = z
  .object({
    categoryId: z.string().min(1, 'Choose a food category'),
    dietaryRequirement: z.enum(['VEG_ONLY', 'ANY']),
    quantityRequired: wholeNumber('quantity', 100_000),
    unit: z.enum(UNITS),
    neededFrom: localDateTime,
    neededUntil: localDateTime,
    location: z.object({ lat: z.number(), lng: z.number() }).refine(isWithinIndiaBounds, 'Choose a location in India').nullable(),
    address: z.union([z.literal(''), z.string().trim().min(5, 'Enter at least 5 characters').max(300, 'Use at most 300 characters')]),
    urgency: z.enum(URGENCIES),
    beneficiariesCount: wholeNumber('number of people', 1_000_000),
    reason: z.string().trim().max(1000, 'Use at most 1000 characters'),
    additionalRequirements: z.string().trim().max(1000, 'Use at most 1000 characters'),
  })
  // `when`: check the time window even while other fields are still invalid, so all errors show at once.
  .refine((v) => istInputToMillis(v.neededUntil) > istInputToMillis(v.neededFrom), { message: 'Must be after the start time', path: ['neededUntil'], when: windowIsComplete })
  .refine((v) => istInputToMillis(v.neededUntil) > Date.now() + MIN_WINDOW_END_MS, { message: 'Must end at least 15 minutes from now', path: ['neededUntil'], when: windowIsComplete });
export type AssistanceFormValues = z.infer<typeof assistanceFormSchema>;

export const ASSISTANCE_FORM_FIELDS = Object.keys(assistanceFormSchema.shape);
/** Backend codes → the field that should show the message. */
export const ASSISTANCE_CODE_MAP: Record<string, string> = {
  LOCATION_OUTSIDE_INDIA: 'location',
  LOCATION_REQUIRED: 'location',
  ADDRESS_REQUIRED: 'address',
  WINDOW_IN_PAST: 'neededUntil',
};
export const ASSISTANCE_FIELD_MAP: Record<string, string> = { 'location.lat': 'location', 'location.lng': 'location' };

export function defaultAssistanceValues(base: { location: { lat: number; lng: number } | null; address: string; beneficiaries: number }, now = Date.now()): AssistanceFormValues {
  // Tomorrow 12:00–14:00 IST is a sensible default for a meal request.
  const tomorrow = new Date(now + 24 * 3_600_000);
  const day = toIstInputValue(tomorrow).slice(0, 10);
  return {
    categoryId: '',
    dietaryRequirement: 'VEG_ONLY',
    quantityRequired: 100,
    unit: 'MEALS',
    neededFrom: `${day}T12:00`,
    neededUntil: `${day}T14:00`,
    location: base.location,
    address: base.address,
    urgency: 'MEDIUM',
    beneficiariesCount: base.beneficiaries > 0 ? base.beneficiaries : 100,
    reason: '',
    additionalRequirements: '',
  };
}

export function toAssistanceCreateInput(v: AssistanceFormValues): AssistanceCreateInput {
  return {
    categoryId: v.categoryId,
    dietaryRequirement: v.dietaryRequirement,
    quantityRequired: v.quantityRequired,
    unit: v.unit,
    neededFrom: fromIstInputValue(v.neededFrom),
    neededUntil: fromIstInputValue(v.neededUntil),
    ...(v.location ? { location: v.location } : {}),
    ...(v.address.trim() ? { address: v.address.trim() } : {}),
    urgency: v.urgency,
    beneficiariesCount: v.beneficiariesCount,
    ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
    ...(v.additionalRequirements.trim() ? { additionalRequirements: v.additionalRequirements.trim() } : {}),
  };
}

/** Editing an existing request (quantity cannot go below what donors already committed). */
export function assistanceEditSchema(minQuantity: number) {
  return z
    .object({
      quantityRequired: wholeNumber('quantity', 100_000).min(Math.max(1, minQuantity), minQuantity > 0 ? `Donors already committed ${minQuantity}` : 'Enter at least 1'),
      neededFrom: localDateTime,
      neededUntil: localDateTime,
      urgency: z.enum(URGENCIES),
      beneficiariesCount: wholeNumber('number of people', 1_000_000),
      reason: z.string().trim().max(1000, 'Use at most 1000 characters'),
      additionalRequirements: z.string().trim().max(1000, 'Use at most 1000 characters'),
    })
    .refine((v) => istInputToMillis(v.neededUntil) > istInputToMillis(v.neededFrom), { message: 'Must be after the start time', path: ['neededUntil'], when: windowIsComplete });
}
export type AssistanceEditValues = z.infer<ReturnType<typeof assistanceEditSchema>>;

export function toEditValues(r: AssistanceRequest): AssistanceEditValues {
  return {
    quantityRequired: r.quantityRequired,
    neededFrom: toIstInputValue(r.neededFrom),
    neededUntil: toIstInputValue(r.neededUntil),
    urgency: r.urgency,
    beneficiariesCount: r.beneficiariesCount,
    reason: r.reason ?? '',
    additionalRequirements: r.additionalRequirements ?? '',
  };
}

/** Only changed fields are sent (with the version for optimistic locking). */
export function toAssistanceUpdate(v: AssistanceEditValues, r: AssistanceRequest): AssistanceUpdateInput {
  const before = toEditValues(r);
  const out: AssistanceUpdateInput = { version: r.version };
  if (v.quantityRequired !== before.quantityRequired) out.quantityRequired = v.quantityRequired;
  if (v.neededFrom !== before.neededFrom) out.neededFrom = fromIstInputValue(v.neededFrom);
  if (v.neededUntil !== before.neededUntil) out.neededUntil = fromIstInputValue(v.neededUntil);
  if (v.urgency !== before.urgency) out.urgency = v.urgency;
  if (v.beneficiariesCount !== before.beneficiariesCount) out.beneficiariesCount = v.beneficiariesCount;
  if (v.reason.trim() !== before.reason.trim()) out.reason = v.reason.trim();
  if (v.additionalRequirements.trim() !== before.additionalRequirements.trim()) out.additionalRequirements = v.additionalRequirements.trim();
  return out;
}

// --- Representatives ---------------------------------------------------------------------
const phone = z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +919876543210');
const last4 = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{4}$/, 'Enter exactly the last 4 letters or digits');

export const addSelfSchema = z.object({ phone, idDocumentType: z.enum(ID_DOCUMENT_TYPES), idDocumentLast4: last4 });
export type AddSelfValues = z.infer<typeof addSelfSchema>;

export const inviteSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
  email: z.email('Enter a valid email address'),
  phone,
  idDocumentType: z.enum(ID_DOCUMENT_TYPES),
  idDocumentLast4: last4,
});
export type InviteValues = z.infer<typeof inviteSchema>;
