import { CRITERION_LABELS } from '@/features/matching/criteria';

/**
 * Admin-editable platform settings, mirroring SETTING_SCHEMAS in
 * backend/src/services/settings.service.ts. The backend validates every update
 * again; these specs drive purpose-built forms and client-side checks.
 */

export const MATCHING_CRITERIA = [
  'distance',
  'food_requirement',
  'quantity_capacity',
  'food_preference',
  'urgency',
  'pickup_availability',
  'reliability',
  'beneficiary_demand',
] as const;
export type MatchingCriterion = (typeof MATCHING_CRITERIA)[number];
export type MatchingWeights = Record<MatchingCriterion, number>;

export const CRITERION_HELP: Record<MatchingCriterion, string> = {
  distance: 'Closer partners rank higher (straight-line distance).',
  food_requirement: 'How well the food matches what the NGO needs.',
  quantity_capacity: 'Whether the quantity fits the NGO’s capacity.',
  food_preference: 'Vegetarian / non-vegetarian compatibility.',
  urgency: 'How urgent the request or the pickup deadline is.',
  pickup_availability: 'Whether pickup hours overlap.',
  reliability: 'Past completed vs failed collections.',
  beneficiary_demand: 'How many people the NGO serves.',
};

export const criterionLabel = (c: string) => CRITERION_LABELS[c] ?? c;

/** Sum of the weights, rounded to 2 decimals to avoid floating-point noise. */
export function weightsSum(values: Record<string, string | number>): number {
  const total = MATCHING_CRITERIA.reduce((acc, c) => acc + (Number(values[c]) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Per-field problem with a weight input (empty, not a number, outside 0–100, more than 2 decimals). */
export function weightError(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'Enter a weight';
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'Use a number from 0 to 100';
  if (Number(v) > 100) return 'At most 100';
  return null;
}

export function parseWeights(values: Record<string, string>): MatchingWeights {
  return Object.fromEntries(MATCHING_CRITERIA.map((c) => [c, Math.round(Number(values[c]) * 100) / 100])) as MatchingWeights;
}

export function weightsToStrings(value: unknown): Record<MatchingCriterion, string> {
  const obj = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(MATCHING_CRITERIA.map((c) => [c, typeof obj[c] === 'number' ? String(obj[c]) : '0'])) as Record<MatchingCriterion, string>;
}

export interface NumberSettingSpec {
  key: string;
  title: string;
  help: string;
  suffix: string;
  min: number;
  max: number;
  integer: boolean;
  /** Strictly greater than `min` (e.g. a positive radius). */
  exclusiveMin?: boolean;
  group: 'Matching' | 'Pickup & tracking' | 'Billing' | 'AI assistant';
}

export const NUMBER_SETTINGS: NumberSettingSpec[] = [
  { key: 'matching.max_radius_km', title: 'Maximum search radius', help: 'Upper bound for the candidate search radius. Each NGO’s own collection radius still applies within it.', suffix: 'km', min: 0, max: 100, integer: false, exclusiveMin: true, group: 'Matching' },
  { key: 'matching.max_notified', title: 'Candidates notified per run', help: 'How many top-ranked partners are notified each time matching runs.', suffix: 'partners', min: 1, max: 100, integer: true, group: 'Matching' },
  { key: 'matching.min_lead_minutes', title: 'Reservation cut-off', help: 'Reservations close this many minutes before the pickup deadline.', suffix: 'minutes', min: 0, max: 720, integer: true, group: 'Matching' },
  { key: 'pickup.qr_ttl_minutes', title: 'QR pass lifetime', help: 'How long a representative’s pickup QR pass stays valid.', suffix: 'minutes', min: 5, max: 240, integer: true, group: 'Pickup & tracking' },
  { key: 'tracking.stale_after_seconds', title: 'Location becomes stale after', help: 'A LiveTrack position older than this is shown as stale, never as live.', suffix: 'seconds', min: 10, max: 3600, integer: true, group: 'Pickup & tracking' },
  { key: 'billing.invoice_due_days', title: 'Invoice payment term', help: 'Days between issuing an invoice and its due date (applies to invoices generated afterwards).', suffix: 'days', min: 1, max: 90, integer: true, group: 'Billing' },
  { key: 'assistant.max_steps', title: 'Assistant steps per turn', help: 'Maximum tool-calling steps the AI assistant may take for one message.', suffix: 'steps', min: 1, max: 10, integer: true, group: 'AI assistant' },
];

/** Validation message for a numeric setting input, or null when valid. */
export function numberSettingError(spec: Pick<NumberSettingSpec, 'min' | 'max' | 'integer' | 'exclusiveMin'>, raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'Enter a value';
  if (spec.integer ? !/^-?\d+$/.test(v) : !/^-?\d+(\.\d+)?$/.test(v)) return spec.integer ? 'Use a whole number' : 'Enter a number';
  const n = Number(v);
  if (spec.exclusiveMin ? n <= spec.min : n < spec.min) return spec.exclusiveMin ? `Must be greater than ${spec.min}` : `At least ${spec.min}`;
  if (n > spec.max) return `At most ${spec.max}`;
  return null;
}

/** Keys that have their own form (everything else falls back to a read-only view). */
export const KNOWN_SETTING_KEYS = new Set<string>(['matching.weights', 'billing.tax', 'platform.demo_data', ...NUMBER_SETTINGS.map((s) => s.key)]);
