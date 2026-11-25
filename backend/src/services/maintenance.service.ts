import type { Logger } from '../config/logger.js';
import type { Database } from '../db/database.js';

/** Retention rules from docs/DATABASE_DESIGN.md §9 (location history is handled by TrackingService). */
const RULES: { name: string; sql: string }[] = [
  { name: 'succeeded jobs (14 days)', sql: `DELETE FROM jobs WHERE status = 'SUCCEEDED' AND updated_at < now() - interval '14 days'` },
  { name: 'expired idempotency records', sql: `DELETE FROM idempotency_records WHERE expires_at < now()` },
  { name: 'ended sessions (30 days)', sql: `DELETE FROM user_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days') OR expires_at < now() - interval '30 days'` },
  { name: 'used/expired account tokens (30 days)', sql: `DELETE FROM account_tokens WHERE created_at < now() - interval '30 days' AND (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at < now())` },
  { name: 'notification delivery logs (90 days)', sql: `DELETE FROM notification_logs WHERE updated_at < now() - interval '90 days'` },
  { name: 'expired pickup tokens (1 year)', sql: `DELETE FROM pickup_tokens WHERE created_at < now() - interval '1 year'` },
];

export class MaintenanceService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async applyRetention(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const rule of RULES) {
      const res = await this.db.query(rule.sql);
      result[rule.name] = res.rowCount ?? 0;
    }
    if (Object.values(result).some((n) => n > 0)) this.logger.info({ retention: result }, 'retention cleanup');
    return result;
  }
}
