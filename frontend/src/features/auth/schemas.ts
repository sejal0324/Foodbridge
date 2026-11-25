import { z } from 'zod';
import { INDIA_STATES_AND_UTS, isWithinIndiaBounds } from '@/utils/india';

/** Mirrors the backend password policy: ≥10 characters, a letter and a digit, ≤128. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one digit');

const emailSchema = z.string().trim().min(1, 'Enter your email address').max(254).pipe(z.email('Enter a valid email address'));

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +919876543210');

const optionalText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().or(z.literal(''));

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const BUSINESS_TYPE_VALUES = ['RESTAURANT', 'HOTEL', 'CAFETERIA', 'CATERER', 'FOOD_BUSINESS', 'OTHER'] as const;

/** Registration form (flat for the UI; converted to the backend's nested shape by `toRegisterInput`). */
export const registerFormSchema = z
  .object({
    accountType: z.enum(['DONOR', 'NGO']),
    fullName: z.string().trim().min(2, 'Enter your full name').max(120),
    email: emailSchema,
    phone: phoneSchema.optional().or(z.literal('')),
    password: passwordSchema,
    confirmPassword: z.string(),
    organizationName: z.string().trim().min(2, 'Enter the organisation name').max(160),
    businessType: z.enum(BUSINESS_TYPE_VALUES),
    licenseNumber: optionalText(60),
    registrationNumber: optionalText(60),
    addressLine: optionalText(300),
    city: optionalText(100),
    state: z.union([z.literal(''), z.string().refine((s) => INDIA_STATES_AND_UTS.includes(s), 'Choose a state or union territory')]),
    postalCode: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z -]{3,12}$/, 'Enter a valid postal code')
      .optional()
      .or(z.literal('')),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .refine(isWithinIndiaBounds, 'Choose a location in India')
      .nullable(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
export type RegisterFormValues = z.infer<typeof registerFormSchema>;

/** Request body of POST /api/auth/register. */
export type RegisterInput =
  | { accountType: 'DONOR'; email: string; password: string; fullName: string; phone?: string; organization: RegisterOrganization & { businessType: string; licenseNumber?: string } }
  | { accountType: 'NGO'; email: string; password: string; fullName: string; phone?: string; organization: RegisterOrganization & { registrationNumber?: string } };

interface RegisterOrganization {
  name: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  location?: { lat: number; lng: number };
}

const opt = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

export function toRegisterInput(v: RegisterFormValues): RegisterInput {
  const organization: RegisterOrganization = {
    name: v.organizationName.trim(),
    addressLine: opt(v.addressLine),
    city: opt(v.city),
    state: opt(v.state),
    postalCode: opt(v.postalCode),
    location: v.location ?? undefined,
  };
  const base = { email: v.email.trim().toLowerCase(), password: v.password, fullName: v.fullName.trim(), phone: opt(v.phone) };
  if (v.accountType === 'DONOR') {
    return { ...base, accountType: 'DONOR', organization: { ...organization, businessType: v.businessType, licenseNumber: opt(v.licenseNumber) } };
  }
  return { ...base, accountType: 'NGO', organization: { ...organization, registrationNumber: opt(v.registrationNumber) } };
}

/** Backend paths (e.g. organization.name) → registration form fields. */
export const REGISTER_FIELD_MAP: Record<string, string> = {
  'organization.name': 'organizationName',
  'organization.businessType': 'businessType',
  'organization.licenseNumber': 'licenseNumber',
  'organization.registrationNumber': 'registrationNumber',
  'organization.addressLine': 'addressLine',
  'organization.city': 'city',
  'organization.state': 'state',
  'organization.postalCode': 'postalCode',
  'organization.location.lat': 'location',
  'organization.location.lng': 'location',
};

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'Choose a password different from the current one', path: ['newPassword'] });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
