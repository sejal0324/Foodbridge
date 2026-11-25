import type { BusinessType, MealPeriod, StorageType, Urgency } from '@/types';

export const STORAGE_LABELS: Record<StorageType, string> = {
  ROOM_TEMPERATURE: 'Room temperature',
  REFRIGERATED: 'Refrigerated',
  FROZEN: 'Frozen',
  HOT_HELD: 'Hot-held',
};

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  RESTAURANT: 'Restaurant',
  HOTEL: 'Hotel',
  CAFETERIA: 'Cafeteria',
  CATERER: 'Caterer',
  FOOD_BUSINESS: 'Food business',
  OTHER: 'Other',
};

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  ALL_DAY: 'All day',
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const DIETARY_LABELS = { VEG: 'Vegetarian', NON_VEG: 'Non-vegetarian', VEG_ONLY: 'Vegetarian only', ANY: 'Any diet' } as const;

export const UNIT_LABELS = { MEALS: 'Meals', PACKETS: 'Packets', BOXES: 'Boxes' } as const;

export const ID_DOCUMENT_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  DRIVING_LICENCE: 'Driving licence',
  VOTER_ID: 'Voter ID',
  OTHER: 'Other ID',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BUSINESS_LICENCE: 'Business licence',
  FSSAI_LICENCE: 'FSSAI licence',
  NGO_REGISTRATION: 'NGO registration',
  TAX_EXEMPTION: 'Tax exemption (80G/12A)',
  ID_PROOF: 'ID proof',
  OTHER: 'Other',
};

export const ISO_DAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
