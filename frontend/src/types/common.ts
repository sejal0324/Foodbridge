/** Enumerations shared by several backend resources (mirrors backend/src/validators/common.ts). */
export const UNITS = ['MEALS', 'PACKETS', 'BOXES'] as const;
export type Unit = (typeof UNITS)[number];

export const DIETARY_TYPES = ['VEG', 'NON_VEG'] as const;
export type DietaryType = (typeof DIETARY_TYPES)[number];

export type DietaryRequirement = 'VEG_ONLY' | 'ANY';

export const STORAGE_TYPES = ['ROOM_TEMPERATURE', 'REFRIGERATED', 'FROZEN', 'HOT_HELD'] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

export const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const MEAL_PERIODS = ['BREAKFAST', 'LUNCH', 'DINNER', 'ALL_DAY'] as const;
export type MealPeriod = (typeof MEAL_PERIODS)[number];

export type Role = 'DONOR' | 'NGO' | 'ADMIN';

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export const BUSINESS_TYPES = ['RESTAURANT', 'HOTEL', 'CAFETERIA', 'CATERER', 'FOOD_BUSINESS', 'OTHER'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface NamedRef {
  id: string;
  name: string;
}
