import { z } from 'zod';
import { DIETARY_TYPES, STORAGE_TYPES, type OfferConfirmInput, type OfferCreateInput } from '@/types';
import { fromIstInputValue, istInputToMillis, toIstInputValue } from '@/utils/format';

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a date and time');
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Offer form; `maxQuantity` and `vegOnly` come from the request being answered. */
export function offerFormSchema(maxQuantity: number, vegOnly: boolean) {
  return z
    .object({
      quantity: z.number({ error: 'Enter a quantity' }).int('Use a whole number').min(1, 'Enter at least 1').max(maxQuantity, `The NGO still needs at most ${maxQuantity}`),
      foodName: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
      dietaryType: z.enum(DIETARY_TYPES),
      pickupAvailableFrom: localDateTime,
      pickupDeadline: localDateTime,
      notes: z.string().trim().max(1000),
      readyNow: z.boolean(),
      preparedAt: z.string(),
      storageType: z.enum(STORAGE_TYPES),
      safetyConfirmed: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (vegOnly && v.dietaryType !== 'VEG') ctx.addIssue({ code: 'custom', path: ['dietaryType'], message: 'This NGO needs vegetarian food only' });
      const from = istInputToMillis(v.pickupAvailableFrom);
      const deadline = istInputToMillis(v.pickupDeadline);
      if (deadline <= Date.now()) ctx.addIssue({ code: 'custom', path: ['pickupDeadline'], message: 'The pickup deadline must be in the future' });
      else if (deadline <= from) ctx.addIssue({ code: 'custom', path: ['pickupDeadline'], message: 'The deadline must be after the start time' });
      if (v.readyNow) {
        const prepared = istInputToMillis(v.preparedAt);
        if (Number.isNaN(prepared)) ctx.addIssue({ code: 'custom', path: ['preparedAt'], message: 'Enter when the food was prepared' });
        else if (prepared > Date.now() + FUTURE_TOLERANCE_MS) ctx.addIssue({ code: 'custom', path: ['preparedAt'], message: 'Preparation time cannot be in the future' });
        if (!v.safetyConfirmed) ctx.addIssue({ code: 'custom', path: ['safetyConfirmed'], message: 'Confirm the food is safe to donate' });
      }
    });
}
export type OfferFormValues = z.infer<ReturnType<typeof offerFormSchema>>;

export function defaultOfferValues(neededFrom: string, quantity: number, vegOnly: boolean): OfferFormValues {
  const now = Date.now();
  const start = Math.max(now, Date.parse(neededFrom) - 2 * 3_600_000);
  return {
    quantity,
    foodName: '',
    dietaryType: vegOnly ? 'VEG' : 'VEG',
    pickupAvailableFrom: toIstInputValue(new Date(start)),
    pickupDeadline: toIstInputValue(new Date(Math.max(start + 3_600_000, Date.parse(neededFrom)))),
    notes: '',
    readyNow: false,
    preparedAt: toIstInputValue(new Date(now)),
    storageType: 'HOT_HELD',
    safetyConfirmed: false,
  };
}

export function toOfferCreateInput(v: OfferFormValues): OfferCreateInput {
  return {
    quantity: v.quantity,
    foodName: v.foodName.trim(),
    dietaryType: v.dietaryType,
    pickupAvailableFrom: fromIstInputValue(v.pickupAvailableFrom),
    pickupDeadline: fromIstInputValue(v.pickupDeadline),
    ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
    ...(v.readyNow ? { readyFood: { preparedAt: fromIstInputValue(v.preparedAt), storageType: v.storageType, safetyConfirmed: true as const } } : {}),
  };
}

export const OFFER_CODE_MAP: Record<string, string> = {
  DIETARY_INCOMPATIBLE: 'dietaryType',
  OFFER_EXCEEDS_REQUIREMENT: 'quantity',
  DEADLINE_IN_PAST: 'pickupDeadline',
  PREPARED_IN_FUTURE: 'preparedAt',
};
export const OFFER_FIELD_MAP: Record<string, string> = {
  'readyFood.preparedAt': 'preparedAt',
  'readyFood.storageType': 'storageType',
  'readyFood.safetyConfirmed': 'safetyConfirmed',
};

/** Confirming an accepted offer: actual quantity, preparation time and storage. */
export function offerConfirmSchema(acceptedQuantity: number) {
  return z
    .object({
      confirmedQuantity: z.number({ error: 'Enter a quantity' }).int('Use a whole number').min(1, 'Enter at least 1').max(acceptedQuantity, `At most the accepted ${acceptedQuantity}`),
      preparedAt: localDateTime,
      storageType: z.enum(STORAGE_TYPES),
      storageNotes: z.string().trim().max(500),
      safetyConfirmed: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (istInputToMillis(v.preparedAt) > Date.now() + FUTURE_TOLERANCE_MS) ctx.addIssue({ code: 'custom', path: ['preparedAt'], message: 'Preparation time cannot be in the future' });
      if (!v.safetyConfirmed) ctx.addIssue({ code: 'custom', path: ['safetyConfirmed'], message: 'Confirm the food is safe to donate' });
    });
}
export type OfferConfirmValues = z.infer<ReturnType<typeof offerConfirmSchema>>;

export function toOfferConfirmInput(v: OfferConfirmValues): OfferConfirmInput {
  return {
    confirmedQuantity: v.confirmedQuantity,
    preparedAt: fromIstInputValue(v.preparedAt),
    storageType: v.storageType,
    safetyConfirmed: true,
    ...(v.storageNotes.trim() ? { storageNotes: v.storageNotes.trim() } : {}),
  };
}
