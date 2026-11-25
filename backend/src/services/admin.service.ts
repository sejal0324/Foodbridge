import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import type { Actor } from '../types/auth.js';
import { notFound, unprocessable } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';

interface Page {
  page: number;
  pageSize: number;
}

/** Read-mostly monitoring queries for the admin console. */
export class AdminService {
  constructor(private readonly db: Database) {}

  async auditLogs(filter: Page & { action?: string | undefined; entityType?: string | undefined; entityId?: string | undefined; actorUserId?: string | undefined }) {
    const where: string[] = ['TRUE'];
    const v: unknown[] = [];
    if (filter.action) where.push(`a.action LIKE $${v.push(`${filter.action}%`)}`);
    if (filter.entityType) where.push(`a.entity_type = $${v.push(filter.entityType)}`);
    if (filter.entityId) where.push(`a.entity_id = $${v.push(filter.entityId)}`);
    if (filter.actorUserId) where.push(`a.actor_user_id = $${v.push(filter.actorUserId)}`);
    const w = where.join(' AND ');
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT a.id, a.occurred_at, a.actor_type, a.actor_user_id, u.email AS actor_email, a.actor_role, a.action, a.entity_type,
              a.entity_id, a.changes, a.metadata, a.request_id, host(a.ip) AS ip
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${w} ORDER BY a.id DESC LIMIT $${v.length + 1} OFFSET $${v.length + 2}`,
      [...v, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    const total = await one<{ n: number }>(this.db, `SELECT count(*) AS n FROM audit_logs a WHERE ${w}`, v);
    return {
      items: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actorType: r.actor_type,
        actorUserId: r.actor_user_id,
        actorEmail: r.actor_email,
        actorRole: r.actor_role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        changes: r.changes,
        metadata: r.metadata,
        requestId: r.request_id,
        ip: r.ip,
      })),
      total: total?.n ?? 0,
    };
  }

  async jobs(filter: Page & { status?: string | undefined }) {
    const status = filter.status ?? 'DEAD';
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT id, type, status, attempts, max_attempts, run_at, last_error, created_at, updated_at
         FROM jobs WHERE status = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
      [status, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    const counts = await many<{ status: string; n: number }>(this.db, 'SELECT status, count(*) AS n FROM jobs GROUP BY status');
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
        runAt: r.run_at,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    };
  }

  /** Re-queues a DEAD job after the underlying problem is fixed. */
  async retryJob(id: number, actor: Actor) {
    await this.db.transaction(async (tx) => {
      const job = await one<{ status: string }>(tx, 'SELECT status FROM jobs WHERE id = $1 FOR UPDATE', [id]);
      if (!job) throw notFound('Job');
      if (job.status !== 'DEAD') throw unprocessable('Only DEAD jobs can be retried.', 'JOB_NOT_DEAD');
      await tx.query(`UPDATE jobs SET status = 'PENDING', attempts = 0, run_at = now(), last_error = NULL WHERE id = $1`, [id]);
      await recordAudit(tx, actor, { action: 'admin.job_retried', entityType: 'job', metadata: { jobId: id } });
    });
  }

  async notificationDeliveries(filter: Page & { status?: string | undefined }) {
    const where = filter.status ? 'l.status = $3' : 'TRUE';
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT l.id, l.channel, l.status, l.attempt_count, l.last_error, l.updated_at, n.type, n.title, u.email
         FROM notification_logs l JOIN notifications n ON n.id = l.notification_id JOIN users u ON u.id = n.user_id
        WHERE ${where} ORDER BY l.updated_at DESC LIMIT $1 OFFSET $2`,
      filter.status ? [filter.pageSize, (filter.page - 1) * filter.pageSize, filter.status] : [filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      attemptCount: r.attempt_count,
      lastError: r.last_error,
      updatedAt: r.updated_at,
      notificationType: r.type,
      title: r.title,
      recipient: r.email,
    }));
  }
}
