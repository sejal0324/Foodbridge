import { hostname } from 'node:os';
import type { Database } from '../db/database.js';
import type { Logger } from '../config/logger.js';
import { enqueueJob } from './queue.js';

export interface JobRecord {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (job: JobRecord) => Promise<void>;

export interface RecurringJob {
  type: string;
  /** Interval in seconds; one job per interval bucket is enqueued (deduplicated across instances). */
  everySeconds: number;
}

/** Thrown by handlers for failures that must not be retried. */
export class PermanentJobError extends Error {}

const STALE_LOCK_MINUTES = 5;

/**
 * Polls the `jobs` table. Claims use FOR UPDATE SKIP LOCKED so several
 * workers/instances never process the same job. Failures are retried with
 * exponential backoff; after max_attempts a job becomes DEAD (visible to admins).
 */
export class JobWorker {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly recurring: RecurringJob[] = [];
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly pollMs = 1000,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  registerRecurring(job: RecurringJob, handler: JobHandler): void {
    this.register(job.type, handler);
    this.recurring.push(job);
  }

  start(): void {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.scheduleRecurring();
        await this.runDue(25);
      } catch (err) {
        this.logger.error({ err }, 'job worker tick failed');
      }
      if (!this.stopped) this.timer = setTimeout(() => void tick(), this.pollMs);
    };
    this.timer = setTimeout(() => void tick(), this.pollMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 25));
  }

  /** Enqueues one job per recurring type per time bucket (dedupe key prevents duplicates). */
  async scheduleRecurring(now = new Date()): Promise<void> {
    for (const job of this.recurring) {
      const bucket = Math.floor(now.getTime() / (job.everySeconds * 1000));
      await enqueueJob(this.db, job.type, {}, { dedupeKey: `recurring:${job.type}:${bucket}`, maxAttempts: 3 });
    }
  }

  /** Processes up to `limit` due jobs; returns how many were processed. Used directly by tests. */
  async runDue(limit = 50): Promise<number> {
    this.running = true;
    let processed = 0;
    try {
      await this.db.query(
        `UPDATE jobs SET status = 'PENDING', locked_at = NULL, locked_by = NULL
          WHERE status = 'RUNNING' AND locked_at < now() - make_interval(mins => $1)`,
        [STALE_LOCK_MINUTES],
      );
      while (processed < limit) {
        const job = await this.claim();
        if (!job) break;
        processed += 1;
        await this.execute(job);
      }
    } finally {
      this.running = false;
    }
    return processed;
  }

  private async claim(): Promise<JobRecord | undefined> {
    const res = await this.db.query<JobRecord>(
      `UPDATE jobs SET status = 'RUNNING', locked_at = now(), locked_by = $1, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM jobs WHERE status = 'PENDING' AND run_at <= now()
           ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, type, payload, attempts, max_attempts`,
      [this.workerId],
    );
    return res.rows[0];
  }

  private async execute(job: JobRecord): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new PermanentJobError(`no handler registered for job type "${job.type}"`);
      await handler(job);
      await this.db.query(
        `UPDATE jobs SET status = 'SUCCEEDED', locked_at = NULL, locked_by = NULL, last_error = NULL WHERE id = $1`,
        [job.id],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentJobError;
      const dead = permanent || job.attempts >= job.max_attempts;
      // Exponential backoff: 5s, 10s, 20s, ... capped at 15 minutes.
      const delaySeconds = Math.min(900, 5 * 2 ** (job.attempts - 1));
      await this.db.query(
        `UPDATE jobs SET status = $2, locked_at = NULL, locked_by = NULL, last_error = $3,
                run_at = CASE WHEN $2 = 'PENDING' THEN now() + make_interval(secs => $4) ELSE run_at END
          WHERE id = $1`,
        [job.id, dead ? 'DEAD' : 'PENDING', message.slice(0, 2000), delaySeconds],
      );
      const log = dead ? this.logger.error.bind(this.logger) : this.logger.warn.bind(this.logger);
      log({ jobId: job.id, type: job.type, attempts: job.attempts, err: message }, dead ? 'job dead' : 'job failed; will retry');
    }
  }
}
