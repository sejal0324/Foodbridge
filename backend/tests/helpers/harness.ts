import { readFile } from 'node:fs/promises';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { parseConfig, type AppConfig } from '../../src/config/env.js';
import { createContext, createServices, createWorker, type AppContext, type ContextOverrides, type Services } from '../../src/container.js';
import type { Database } from '../../src/db/database.js';
import type { LogEmailProvider } from '../../src/integrations/email.js';
import type { JobWorker } from '../../src/jobs/worker.js';
import { RecordingRealtime } from '../../src/sockets/realtime.js';
import { REFERENCE_SNAPSHOT } from '../setup/test-env.js';

export interface Harness {
  config: AppConfig;
  ctx: AppContext;
  services: Services;
  app: Express;
  worker: JobWorker;
  realtime: RecordingRealtime;
  http: ReturnType<typeof request>;
  devEmail: LogEmailProvider;
  close(): Promise<void>;
}

export async function createHarness(
  configOverrides: (c: AppConfig) => AppConfig = (c) => c,
  overrides: ContextOverrides & { services?: (s: Services, ctx: AppContext) => void } = {},
): Promise<Harness> {
  const config = configOverrides(parseConfig(process.env));
  const ctx = createContext(config, overrides);
  const services = createServices(ctx);
  overrides.services?.(services, ctx);
  const realtime = new RecordingRealtime();
  ctx.realtime.attach(realtime);
  const app = createApp(ctx, services);
  const worker = createWorker(ctx, services);
  await resetDatabase(ctx.db);
  return {
    config,
    ctx,
    services,
    app,
    worker,
    realtime,
    http: request(app),
    devEmail: ctx.email as LogEmailProvider,
    close: () => ctx.db.close(),
  };
}

let snapshot: Record<string, unknown[]> | undefined;

/** Removes all data and restores reference rows seeded by migrations. */
export async function resetDatabase(db: Database): Promise<void> {
  snapshot ??= JSON.parse(await readFile(REFERENCE_SNAPSHOT, 'utf8')) as Record<string, unknown[]>;
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('spatial_ref_sys', 'pgmigrations')`,
  );
  await db.query(`TRUNCATE ${tables.rows.map((t) => `"${t.table_name}"`).join(', ')} RESTART IDENTITY CASCADE`);
  for (const [table, rows] of Object.entries(snapshot)) {
    if (rows.length === 0) continue;
    await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
  }
}
