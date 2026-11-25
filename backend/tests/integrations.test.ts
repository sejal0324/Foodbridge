import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailMessage, EmailProvider } from '../src/integrations/email.js';
import { PASSWORD, createAdmin, registerDonor } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';

class FlakyEmail implements EmailProvider {
  readonly name = 'smtp' as const;
  readonly configured = true;
  failuresLeft = 2;
  sent: EmailMessage[] = [];
  send(message: EmailMessage) {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      return Promise.reject(new Error('SMTP connection refused'));
    }
    this.sent.push(message);
    return Promise.resolve({ messageId: `msg-${this.sent.length}` });
  }
}

describe('notification email delivery retries', () => {
  let h: Harness;
  const email = new FlakyEmail();
  beforeAll(async () => {
    h = await createHarness((c) => c, { email });
  });
  beforeEach(() => resetDatabase(h.ctx.db));
  afterAll(() => h.close());

  it('retries a failed email with backoff and records the delivery status (Notification failure → retry)', async () => {
    await createAdmin(h);
    await registerDonor(h); // notifies the admin, with an email copy only for verification-pending? no: registration notice is in-app.
    const admin = await h.ctx.db.query<{ id: string }>(`SELECT id FROM users WHERE role = 'ADMIN'`);
    await h.services.notifications.notify({ userId: admin.rows[0]?.id as string, type: 'TEST_NOTICE', title: 'Test', body: 'Hello', dedupeKey: 'test-1', email: true });
    const runAll = async () => {
      await h.ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'PENDING'`);
      return h.worker.runDue();
    };
    await runAll();
    let log = await h.ctx.db.query('SELECT status, attempt_count, last_error FROM notification_logs');
    expect(log.rows[0]).toMatchObject({ status: 'FAILED', attempt_count: 1, last_error: 'SMTP connection refused' });
    await runAll();
    await runAll();
    log = await h.ctx.db.query('SELECT status, attempt_count FROM notification_logs');
    expect(log.rows[0]).toMatchObject({ status: 'SENT', attempt_count: 3 });
    expect(email.sent).toHaveLength(1);
    const job = await h.ctx.db.query(`SELECT status, attempts FROM jobs WHERE type = 'deliver-notification-email'`);
    expect(job.rows[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 3 });
  });

  it('marks a job DEAD after max attempts, visible to admins, and lets an admin retry it', async () => {
    const admin = await createAdmin(h);
    email.failuresLeft = 100;
    await h.services.notifications.notify({ userId: admin.userId, type: 'TEST_NOTICE', title: 'Test', body: 'Hello', dedupeKey: 'test-2', email: true });
    for (let i = 0; i < 5; i++) {
      await h.ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'PENDING'`);
      await h.worker.runDue();
    }
    const dead = await h.http.get('/api/admin/jobs?status=DEAD').set(admin.auth).expect(200);
    expect(dead.body.data.items[0]).toMatchObject({ type: 'deliver-notification-email', status: 'DEAD', attempts: 5 });
    email.failuresLeft = 0;
    await h.http.post(`/api/admin/jobs/${dead.body.data.items[0].id}/retry`).set(admin.auth).expect(204);
    await h.worker.runDue();
    const log = await h.ctx.db.query('SELECT status FROM notification_logs');
    expect(log.rows[0]?.status).toBe('SENT');
  });
});

describe('rate limiting', () => {
  it('returns 429 after too many login attempts from one client', async () => {
    const h = await createHarness((c) => ({ ...c, rateLimitEnabled: true }));
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        statuses.push((await h.http.post('/api/auth/login').send({ email: 'attacker@example.org', password: PASSWORD })).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    } finally {
      await h.close();
    }
  });
});

describe('retention housekeeping', () => {
  it('deletes only records past their retention period', async () => {
    const h = await createHarness();
    try {
      await resetDatabase(h.ctx.db);
      await h.ctx.db.query(`INSERT INTO jobs (type, status, updated_at) VALUES ('old', 'SUCCEEDED', now() - interval '20 days'), ('recent', 'SUCCEEDED', now()), ('dead', 'DEAD', now() - interval '20 days')`);
      await h.ctx.db.query(`INSERT INTO idempotency_records (scope, key, request_hash, status, expires_at) VALUES ('s', 'expired-key-1', 'h', 'COMPLETED', now() - interval '1 hour'), ('s', 'live-key-0001', 'h', 'COMPLETED', now() + interval '1 hour')`);
      const result = await h.services.maintenance.applyRetention();
      expect(result['succeeded jobs (14 days)']).toBe(1);
      expect(result['expired idempotency records']).toBe(1);
      const jobs = await h.ctx.db.query('SELECT type FROM jobs ORDER BY type');
      expect(jobs.rows.map((r) => r.type)).toEqual(['dead', 'recent']); // DEAD jobs stay visible to admins
    } finally {
      await h.close();
    }
  });
});
