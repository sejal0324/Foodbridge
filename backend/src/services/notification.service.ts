import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import type { Logger } from '../config/logger.js';
import type { EmailProvider } from '../integrations/email.js';
import { EmailNotConfiguredError } from '../integrations/email.js';
import { enqueueJob } from '../jobs/queue.js';
import { PermanentJobError, type JobRecord } from '../jobs/worker.js';
import type { Realtime } from '../sockets/realtime.js';
import { notFound } from '../utils/errors.js';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  linkPath?: string;
  priority?: NotificationPriority;
  /** Same user + dedupe key is stored only once. */
  dedupeKey: string;
  /** Skip (return null) when the user already received max_per_hour notifications. Use for low-value bulk alerts. */
  respectFrequencyLimit?: boolean;
  /** Send an email copy (subject to preferences and provider configuration). */
  email?: boolean;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  link_path: string | null;
  priority: NotificationPriority;
  read_at: Date | null;
  created_at: Date;
}

const COLUMNS = 'id, user_id, type, title, body, data, link_path, priority, read_at, created_at';
export const EMAIL_JOB = 'deliver-notification-email';

export function toNotificationDto(n: NotificationRow) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    linkPath: n.link_path,
    priority: n.priority,
    readAt: n.read_at,
    createdAt: n.created_at,
  };
}

/**
 * In-app notifications are the system of record (the row *is* the in-app
 * delivery). Socket emission is best-effort and happens after commit; email
 * is delivered by a retrying background job whose status is kept in
 * notification_logs.
 */
export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly realtime: Realtime,
    private readonly email: EmailProvider,
    private readonly logger: Logger,
  ) {}

  /** Creates a notification inside the caller's transaction. Returns null when deduplicated or rate-limited. */
  async create(q: Queryable, input: NotificationInput): Promise<NotificationRow | null> {
    const prefs = await one<{ email_enabled: boolean; max_per_hour: number }>(
      q,
      'SELECT email_enabled, max_per_hour FROM notification_preferences WHERE user_id = $1',
      [input.userId],
    );
    const maxPerHour = prefs?.max_per_hour ?? 20;
    if (input.respectFrequencyLimit) {
      const recent = await one<{ n: number }>(
        q,
        `SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [input.userId],
      );
      if ((recent?.n ?? 0) >= maxPerHour) {
        this.logger.debug({ userId: input.userId, type: input.type }, 'notification skipped: frequency limit');
        return null;
      }
    }
    const row = await one<NotificationRow>(
      q,
      `INSERT INTO notifications (user_id, type, title, body, data, link_path, priority, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        input.userId,
        input.type,
        input.title.slice(0, 160),
        input.body.slice(0, 2000),
        JSON.stringify(input.data ?? {}),
        input.linkPath ?? null,
        input.priority ?? 'NORMAL',
        input.dedupeKey,
      ],
    );
    if (!row) return null;

    if (input.email) {
      const emailAllowed = prefs?.email_enabled ?? true;
      const status = !emailAllowed ? 'SKIPPED' : this.email.configured ? 'PENDING' : 'SKIPPED';
      const reason = !emailAllowed ? 'disabled by user preference' : this.email.configured ? null : 'email provider not configured';
      const log = await one<{ id: number }>(
        q,
        `INSERT INTO notification_logs (notification_id, channel, status, last_error) VALUES ($1, 'EMAIL', $2, $3) RETURNING id`,
        [row.id, status, reason],
      );
      if (status === 'PENDING' && log) {
        await enqueueJob(q, EMAIL_JOB, { notificationLogId: log.id }, { maxAttempts: 5, dedupeKey: `email:${log.id}` });
      }
    }
    return row;
  }

  /** Emits socket events for committed notifications (best-effort). */
  publish(rows: (NotificationRow | null)[]): void {
    for (const row of rows) {
      if (!row) continue;
      try {
        this.realtime.toUser(row.user_id, 'notification:new', toNotificationDto(row));
      } catch (err) {
        this.logger.warn({ err, notificationId: row.id }, 'socket emission failed; client will refetch');
      }
    }
  }

  /** Convenience: create in its own transaction and publish. */
  async notify(input: NotificationInput): Promise<NotificationRow | null> {
    const row = await this.db.transaction((tx) => this.create(tx, input));
    this.publish([row]);
    return row;
  }

  async list(userId: string, opts: { unreadOnly: boolean; page: number; pageSize: number }) {
    const where = `user_id = $1 ${opts.unreadOnly ? 'AND read_at IS NULL' : ''}`;
    const [rows, total, unread] = await Promise.all([
      many<NotificationRow>(this.db, `SELECT ${COLUMNS} FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [
        userId,
        opts.pageSize,
        (opts.page - 1) * opts.pageSize,
      ]),
      one<{ n: number }>(this.db, `SELECT count(*) AS n FROM notifications WHERE ${where}`, [userId]),
      one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]),
    ]);
    return { items: rows.map(toNotificationDto), total: total?.n ?? 0, unread: unread?.n ?? 0 };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [id, userId]);
    if (res.rowCount === 0) throw notFound('Notification');
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return res.rowCount ?? 0;
  }

  async getPreferences(userId: string) {
    const row = await one<{
      email_enabled: boolean;
      max_per_hour: number;
      max_distance_km: number | null;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
    }>(
      this.db,
      `SELECT email_enabled, max_per_hour, max_distance_km, to_char(quiet_hours_start, 'HH24:MI') AS quiet_hours_start,
              to_char(quiet_hours_end, 'HH24:MI') AS quiet_hours_end
         FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return {
      emailEnabled: row?.email_enabled ?? true,
      maxPerHour: row?.max_per_hour ?? 20,
      maxDistanceKm: row?.max_distance_km ?? null,
      quietHoursStart: row?.quiet_hours_start ?? null,
      quietHoursEnd: row?.quiet_hours_end ?? null,
      emailDeliveryAvailable: this.email.configured,
    };
  }

  async updatePreferences(
    userId: string,
    p: { emailEnabled: boolean; maxPerHour: number; maxDistanceKm: number | null; quietHoursStart: string | null; quietHoursEnd: string | null },
  ) {
    await this.db.query(
      `INSERT INTO notification_preferences (user_id, email_enabled, max_per_hour, max_distance_km, quiet_hours_start, quiet_hours_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, max_per_hour = EXCLUDED.max_per_hour,
         max_distance_km = EXCLUDED.max_distance_km, quiet_hours_start = EXCLUDED.quiet_hours_start, quiet_hours_end = EXCLUDED.quiet_hours_end`,
      [userId, p.emailEnabled, p.maxPerHour, p.maxDistanceKm, p.quietHoursStart, p.quietHoursEnd],
    );
    return this.getPreferences(userId);
  }

  /** Job handler: delivers one email; throws to trigger a retry with backoff. */
  async deliverEmail(job: JobRecord): Promise<void> {
    const logId = Number(job.payload.notificationLogId);
    const row = await one<{ status: string; title: string; body: string; link_path: string | null; email: string; account_status: string }>(
      this.db,
      `SELECT l.status, n.title, n.body, n.link_path, u.email, u.account_status
         FROM notification_logs l JOIN notifications n ON n.id = l.notification_id JOIN users u ON u.id = n.user_id
        WHERE l.id = $1`,
      [logId],
    );
    if (!row || row.status === 'SENT' || row.status === 'SKIPPED') return;
    if (row.account_status !== 'ACTIVE') {
      await this.db.query(`UPDATE notification_logs SET status = 'SKIPPED', last_error = 'account not active' WHERE id = $1`, [logId]);
      return;
    }
    try {
      const text = row.link_path ? `${row.body}\n\nOpen in FoodBridge: ${row.link_path}` : row.body;
      const result = await this.email.send({ to: row.email, subject: `FoodBridge: ${row.title}`, text });
      await this.db.query(
        `UPDATE notification_logs SET status = 'SENT', attempt_count = attempt_count + 1, provider_message_id = $2, last_error = NULL WHERE id = $1`,
        [logId, result.messageId],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = err instanceof EmailNotConfiguredError || job.attempts >= job.max_attempts;
      await this.db.query(
        `UPDATE notification_logs SET status = 'FAILED', attempt_count = attempt_count + 1, last_error = $2,
                next_attempt_at = CASE WHEN $3 THEN NULL ELSE now() + make_interval(secs => $4) END
          WHERE id = $1`,
        [logId, message.slice(0, 500), final, Math.min(900, 5 * 2 ** (job.attempts - 1))],
      );
      if (err instanceof EmailNotConfiguredError) throw new PermanentJobError(message);
      throw err;
    }
  }

  /** Notifies every active admin (e.g. a new verification application). */
  async notifyAdmins(q: Queryable, input: Omit<NotificationInput, 'userId'>): Promise<(NotificationRow | null)[]> {
    const admins = await many<{ id: string }>(
      q,
      `SELECT id FROM users WHERE role = 'ADMIN' AND account_status = 'ACTIVE' AND deleted_at IS NULL`,
    );
    const rows: (NotificationRow | null)[] = [];
    for (const a of admins) rows.push(await this.create(q, { ...input, userId: a.id }));
    return rows;
  }
}
