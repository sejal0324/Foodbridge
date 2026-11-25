import { z } from 'zod';
import { DIETARY_TYPES, STORAGE_TYPES, UNITS, type DonationCreateInput, type DonationDetail, type DonationUpdateInput } from '@/types';
import { fromIstInputValue, istInputToMillis, toIstInputValue } from '@/utils/format';
import { isWithinIndiaBounds } from '@/utils/india';

/** The backend accepts preparation times at most 5 minutes in the future. */
const PREPARED_FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Reservations close this many minutes before the deadline (platform default). */
export const MIN_LEAD_MINUTES = 30;

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a date and time');
const optionalLocalDateTime = z.union([z.literal(''), localDateTime]);
const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).refine(isWithinIndiaBounds, 'Choose a location in India');

/** Create-donation form (times are datetime-local values in IST). */
export const donationFormSchema = z
  .object({
    foodName: z.string().trim().min(2, 'Enter at least 2 characters').max(120, 'Use at most 120 characters'),
    categoryId: z.string().min(1, 'Choose a category'),
    dietaryType: z.enum(DIETARY_TYPES),
    quantity: z.number({ error: 'Enter a quantity' }).int('Use a whole number').min(1, 'Enter at least 1').max(100000, 'That quantity is too large'),
    unit: z.enum(UNITS),
    preparedAt: localDateTime,
    bestBefore: optionalLocalDateTime,
    storageType: z.enum(STORAGE_TYPES),
    storageNotes: z.string().trim().max(500, 'Use at most 500 characters'),
    pickupAvailableFrom: optionalLocalDateTime,
    pickupDeadline: localDateTime,
    location: latLng.nullable(),
    address: z.union([z.literal(''), z.string().trim().min(5, 'Enter at least 5 characters').max(300, 'Use at most 300 characters')]),
    description: z.string().trim().max(2000, 'Use at most 2000 characters'),
    safetyConfirmed: z.boolean(),
    publish: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const now = Date.now();
    const prepared = istInputToMillis(v.preparedAt);
    const deadline = istInputToMillis(v.pickupDeadline);
    const from = v.pickupAvailableFrom ? istInputToMillis(v.pickupAvailableFrom) : now;
    if (prepared > now + PREPARED_FUTURE_TOLERANCE_MS) {
      ctx.addIssue({ code: 'custom', path: ['preparedAt'], message: 'Preparation time cannot be in the future: list food that already exists' });
    }
    if (deadline <= now) ctx.addIssue({ code: 'custom', path: ['pickupDeadline'], message: 'The pickup deadline must be in the future' });
    else if (deadline <= from) ctx.addIssue({ code: 'custom', path: ['pickupDeadline'], message: 'The deadline must be after the pickup start time' });
    if (v.bestBefore && istInputToMillis(v.bestBefore) <= prepared) {
      ctx.addIssue({ code: 'custom', path: ['bestBefore'], message: 'Best-before must be after preparation' });
    }
    if (v.publish && !v.safetyConfirmed) {
      ctx.addIssue({ code: 'custom', path: ['safetyConfirmed'], message: 'Confirm the food is safe to donate before publishing (drafts can be saved without it)' });
    }
  });
export type DonationFormValues = z.infer<typeof donationFormSchema>;

export function defaultDonationFormValues(now: Date = new Date()): DonationFormValues {
  return {
    foodName: '',
    categoryId: '',
    dietaryType: 'VEG',
    quantity: Number.NaN,
    unit: 'MEALS',
    preparedAt: toIstInputValue(now),
    bestBefore: '',
    storageType: 'ROOM_TEMPERATURE',
    storageNotes: '',
    pickupAvailableFrom: toIstInputValue(now),
    pickupDeadline: toIstInputValue(new Date(now.getTime() + 3 * 3_600_000)),
    location: null,
    address: '',
    description: '',
    safetyConfirmed: false,
    publish: true,
  };
}

const opt = (s: string) => (s.trim() === '' ? undefined : s.trim());

export function toDonationCreateInput(v: DonationFormValues): DonationCreateInput {
  return {
    foodName: v.foodName.trim(),
    categoryId: v.categoryId,
    dietaryType: v.dietaryType,
    quantity: v.quantity,
    unit: v.unit,
    preparedAt: fromIstInputValue(v.preparedAt),
    ...(v.bestBefore ? { bestBefore: fromIstInputValue(v.bestBefore) } : {}),
    storageType: v.storageType,
    ...(opt(v.storageNotes) ? { storageNotes: opt(v.storageNotes) } : {}),
    ...(v.pickupAvailableFrom ? { pickupAvailableFrom: fromIstInputValue(v.pickupAvailableFrom) } : {}),
    pickupDeadline: fromIstInputValue(v.pickupDeadline),
    ...(v.location ? { location: v.location } : {}),
    ...(opt(v.address) ? { address: opt(v.address) } : {}),
    ...(opt(v.description) ? { description: opt(v.description) } : {}),
    safetyConfirmed: v.safetyConfirmed,
    publish: v.publish,
  };
}

/** Backend validation paths → form fields. */
export const DONATION_FIELD_MAP: Record<string, string> = { 'location.lat': 'location', 'location.lng': 'location' };

/** Business error codes → the field that should show the message. */
export const DONATION_CODE_MAP: Record<string, string> = {
  LOCATION_REQUIRED: 'location',
  LOCATION_OUTSIDE_INDIA: 'location',
  ADDRESS_REQUIRED: 'address',
  PREPARED_IN_FUTURE: 'preparedAt',
  DEADLINE_TOO_SOON: 'pickupDeadline',
  INVALID_PICKUP_WINDOW: 'pickupDeadline',
  SAFETY_CONFIRMATION_REQUIRED: 'safetyConfirmed',
  UNKNOWN_CATEGORY: 'categoryId',
  QUANTITY_BELOW_RESERVED: 'quantity',
};

export const DONATION_FORM_FIELDS = Object.keys(donationFormSchema.shape) as (keyof DonationFormValues)[];

// --- Edit (PATCH with optimistic-concurrency version) ------------------------------
export const donationEditSchema = z
  .object({
    foodName: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
    quantity: z.number({ error: 'Enter a quantity' }).int('Use a whole number').min(1, 'Enter at least 1').max(100000),
    storageType: z.enum(STORAGE_TYPES),
    storageNotes: z.string().trim().max(500),
    pickupAvailableFrom: localDateTime,
    pickupDeadline: localDateTime,
    description: z.string().trim().max(2000),
    safetyConfirmed: z.boolean(),
  })
  .refine((v) => istInputToMillis(v.pickupDeadline) > istInputToMillis(v.pickupAvailableFrom), { path: ['pickupDeadline'], message: 'The deadline must be after the pickup start time' });
export type DonationEditValues = z.infer<typeof donationEditSchema>;

export function editValuesFrom(d: DonationDetail): DonationEditValues {
  return {
    foodName: d.foodName,
    quantity: d.quantity,
    storageType: d.storageType,
    storageNotes: d.storageNotes ?? '',
    pickupAvailableFrom: toIstInputValue(d.pickupAvailableFrom),
    pickupDeadline: toIstInputValue(d.pickupDeadline),
    description: d.description ?? '',
    safetyConfirmed: d.safetyConfirmed,
  };
}

/** Only changed fields are sent, together with the version the user edited. */
export function toDonationUpdateInput(d: DonationDetail, v: DonationEditValues, publish: boolean): DonationUpdateInput {
  const initial = editValuesFrom(d);
  const out: DonationUpdateInput = { version: d.version };
  if (v.foodName.trim() !== initial.foodName) out.foodName = v.foodName.trim();
  if (v.quantity !== initial.quantity) out.quantity = v.quantity;
  if (v.storageType !== initial.storageType) out.storageType = v.storageType;
  if (v.storageNotes.trim() !== initial.storageNotes && v.storageNotes.trim() !== '') out.storageNotes = v.storageNotes.trim();
  if (v.pickupAvailableFrom !== initial.pickupAvailableFrom) out.pickupAvailableFrom = fromIstInputValue(v.pickupAvailableFrom);
  if (v.pickupDeadline !== initial.pickupDeadline) out.pickupDeadline = fromIstInputValue(v.pickupDeadline);
  if (v.description.trim() !== initial.description && v.description.trim() !== '') out.description = v.description.trim();
  if (v.safetyConfirmed !== initial.safetyConfirmed) out.safetyConfirmed = v.safetyConfirmed;
  if (publish) out.publish = true;
  return out;
}

/** Status groups for the donations list filter. */
export const DONATION_STATUS_FILTERS = [
  { value: 'all', label: 'All', statuses: '' },
  { value: 'open', label: 'Open', statuses: 'AVAILABLE,PARTIALLY_RESERVED' },
  { value: 'reserved', label: 'Reserved', statuses: 'RESERVED,PICKUP_ASSIGNED' },
  { value: 'progress', label: 'In progress', statuses: 'PICKED_UP,IN_TRANSIT' },
  { value: 'completed', label: 'Completed', statuses: 'COMPLETED' },
  { value: 'drafts', label: 'Drafts', statuses: 'DRAFT' },
  { value: 'closed', label: 'Expired / cancelled', statuses: 'EXPIRED,CANCELLED' },
  { value: 'disputed', label: 'Disputed', statuses: 'DISPUTED' },
] as const;
