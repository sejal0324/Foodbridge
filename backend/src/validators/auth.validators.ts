import { z } from 'zod';
import { email, latLng, optionalText, password, phone } from './common.js';

const address = {
  addressLine: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z -]{3,12}$/, 'invalid postal code')
    .optional(),
  location: latLng.optional(),
};

const base = {
  email,
  password,
  fullName: z.string().trim().min(2).max(120),
  phone: phone.optional(),
};

/**
 * Self-registration is limited to DONOR and NGO account types. There is no
 * way to request an ADMIN account through the API.
 */
export const registerSchema = z.discriminatedUnion('accountType', [
  z.object({
    ...base,
    accountType: z.literal('DONOR'),
    organization: z.object({
      name: z.string().trim().min(2).max(160),
      businessType: z.enum(['RESTAURANT', 'HOTEL', 'CAFETERIA', 'CATERER', 'FOOD_BUSINESS', 'OTHER']).default('RESTAURANT'),
      licenseNumber: optionalText(60),
      ...address,
    }),
  }),
  z.object({
    ...base,
    accountType: z.literal('NGO'),
    organization: z.object({
      name: z.string().trim().min(2).max(160),
      registrationNumber: optionalText(60),
      ...address,
    }),
  }),
]);

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const acceptInviteSchema = z.object({ token: z.string().min(20).max(200), password });
export const passwordResetRequestSchema = z.object({ email });
export const passwordResetSchema = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
