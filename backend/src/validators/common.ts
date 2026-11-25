import type { Request } from 'express';
import { z, type ZodError, type ZodType } from 'zod';
import { AppError, validationError } from '../utils/errors.js';
import { isInIndia } from '../utils/india.js';

export function formatZodIssues(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function parseWith<T extends ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    // A refinement can carry a specific business error code (e.g. LOCATION_OUTSIDE_INDIA).
    for (const issue of result.error.issues) {
      const code: unknown = issue.code === 'custom' ? issue.params?.code : undefined;
      if (typeof code === 'string') throw new AppError(422, code, issue.message, formatZodIssues(result.error));
    }
    throw validationError(formatZodIssues(result.error));
  }
  return result.data;
}

export const parseBody = <T extends ZodType>(schema: T, req: Request): z.infer<T> => parseWith(schema, req.body ?? {});
export const parseQuery = <T extends ZodType>(schema: T, req: Request): z.infer<T> => parseWith(schema, req.query);
export const parseParams = <T extends ZodType>(schema: T, req: Request): z.infer<T> => parseWith(schema, req.params);

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------
export const uuid = z.uuid();
export const idParams = z.object({ id: z.uuid() });

export const UNITS = ['MEALS', 'PACKETS', 'BOXES'] as const;
export const unit = z.enum(UNITS);
export type Unit = z.infer<typeof unit>;
export const dietaryType = z.enum(['VEG', 'NON_VEG']);
export const dietaryRequirement = z.enum(['VEG_ONLY', 'ANY']);
export const storageType = z.enum(['ROOM_TEMPERATURE', 'REFRIGERATED', 'FROZEN', 'HOT_HELD']);
export const urgency = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const mealPeriod = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'ALL_DAY']);

/** Whole-number quantity of meals, packets or boxes. */
export const quantity = z.coerce.number().int('must be a whole number').positive().max(100000);

/** A place in India (organisations, donations, requests, destinations). GPS tracking points use their own fields. */
export const latLng = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  })
  .refine(isInIndia, { message: 'FoodBridge currently operates only within India. Choose a location in India.', params: { code: 'LOCATION_OUTSIDE_INDIA' } });
export type LatLng = z.infer<typeof latLng>;

export const isoDateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
export const isoDate = z.iso.date();

/** E.164 phone number, e.g. +919876543210. */
export const phone = z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, 'must be in international format, e.g. +919876543210');

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** At least 10 characters with a letter and a digit; max 128 (Argon2 handles long inputs, but bound it). */
export const password = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'must contain a letter')
  .regex(/[0-9]/, 'must contain a digit');

export const shortText = (max: number) => z.string().trim().max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v));

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof pagination>;
