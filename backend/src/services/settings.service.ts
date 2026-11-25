import { z } from 'zod';
import type { Database, Queryable } from '../db/database.js';
import type { Actor } from '../types/auth.js';
import { notFound, validationError } from '../utils/errors.js';
import { formatZodIssues } from '../validators/common.js';
import { recordAudit } from './audit.service.js';

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

const weightsSchema = z
  .object(Object.fromEntries(MATCHING_CRITERIA.map((c) => [c, z.number().min(0).max(100)])) as Record<
    MatchingCriterion,
    z.ZodNumber
  >)
  .strict()
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 1e-9, 'weights must sum to 100');

/** Every configurable setting with its validation schema. */
export const SETTING_SCHEMAS = {
  'matching.weights': weightsSchema,
  'matching.max_radius_km': z.number().positive().max(100),
  'matching.max_notified': z.number().int().min(1).max(100),
  'matching.min_lead_minutes': z.number().int().min(0).max(720),
  'pickup.qr_ttl_minutes': z.number().int().min(5).max(240),
  'tracking.stale_after_seconds': z.number().int().min(10).max(3600),
  'billing.tax': z
    .object({ enabled: z.boolean(), name: z.string().min(1).max(20), rate_percent: z.number().min(0).max(100) })
    .strict(),
  'billing.invoice_due_days': z.number().int().min(1).max(90),
  'assistant.max_steps': z.number().int().min(1).max(10),
  /** Set by the development seed so analytics label demo records instead of presenting them as real statistics. */
  'platform.demo_data': z.object({ seeded: z.boolean(), seededAt: z.string().optional(), note: z.string().optional() }).strict(),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_SCHEMAS, key);
}

/** Reads and updates admin-configurable platform settings (validated, audited). */
export class SettingsService {
  constructor(private readonly db: Database) {}

  async get<K extends SettingKey>(key: K, q: Queryable = this.db): Promise<SettingValue<K>> {
    const res = await q.query<{ value: unknown }>('SELECT value FROM platform_settings WHERE key = $1', [key]);
    const row = res.rows[0];
    if (!row) throw notFound(`Setting ${key}`);
    return SETTING_SCHEMAS[key].parse(row.value) as SettingValue<K>;
  }

  async list(): Promise<{ key: string; value: unknown; description: string | null; updatedAt: Date }[]> {
    const res = await this.db.query<{ key: string; value: unknown; description: string | null; updated_at: Date }>(
      'SELECT key, value, description, updated_at FROM platform_settings ORDER BY key',
    );
    return res.rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updated_at }));
  }

  async update(key: string, value: unknown, actor: Actor): Promise<unknown> {
    if (!isSettingKey(key)) throw notFound(`Setting ${key}`);
    const parsed = SETTING_SCHEMAS[key].safeParse(value);
    if (!parsed.success) throw validationError(formatZodIssues(parsed.error));
    return this.db.transaction(async (tx) => {
      const before = await tx.query<{ value: unknown }>('SELECT value FROM platform_settings WHERE key = $1 FOR UPDATE', [key]);
      if (!before.rows[0]) throw notFound(`Setting ${key}`);
      await tx.query('UPDATE platform_settings SET value = $2, updated_by = $3 WHERE key = $1', [
        key,
        JSON.stringify(parsed.data),
        actor.userId,
      ]);
      await recordAudit(tx, actor, {
        action: 'settings.updated',
        entityType: 'platform_setting',
        changes: { key, before: before.rows[0].value, after: parsed.data },
      });
      return parsed.data;
    });
  }
}
