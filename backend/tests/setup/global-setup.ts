import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';
import { applyTestEnv, REFERENCE_SNAPSHOT } from './test-env.js';

export const REFERENCE_TABLES = ['food_categories', 'reward_rules', 'reward_tiers', 'service_fee_rules', 'platform_settings'];

/**
 * Rebuilds the test database from scratch on every run: all migrations down,
 * then all up. This exercises every down migration as well as every up
 * migration. Reference data seeded by migrations is snapshotted so each test
 * can restore it after truncating.
 */
export default async function setup(): Promise<void> {
  applyTestEnv();
  const databaseUrl = process.env.DATABASE_URL as string;
  await migrate({ databaseUrl, direction: 'down', count: Infinity });
  const applied = await migrate({ databaseUrl, direction: 'up' });
  if (applied.length === 0) throw new Error('no migrations applied');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const snapshot: Record<string, unknown[]> = {};
    for (const table of REFERENCE_TABLES) {
      snapshot[table] = (await client.query(`SELECT to_jsonb(t) AS j FROM ${table} t`)).rows.map((r: { j: unknown }) => r.j);
    }
    await writeFile(REFERENCE_SNAPSHOT, JSON.stringify(snapshot));
  } finally {
    await client.end();
  }
}
