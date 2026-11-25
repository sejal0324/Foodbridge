/**
 * DEVELOPMENT-ONLY: rebuilds the development database from scratch (all
 * migrations down, then up) and loads the demo seed. Refuses in production.
 */
import { spawnSync } from 'node:child_process';
import { loadEnvFiles, parseConfig } from '../config/env.js';
import { migrate } from './migrate.js';

async function main() {
  loadEnvFiles();
  const config = parseConfig();
  if (config.isProduction) throw new Error('Refusing to reset a production database.');
  const db = new URL(config.database.url);
  console.log(`Resetting ${db.host}${db.pathname} (development)…`);
  await migrate({ databaseUrl: config.database.url, direction: 'down', count: Infinity });
  const applied = await migrate({ databaseUrl: config.database.url, direction: 'up' });
  console.log(`Applied ${applied.length} migrations.`);
  const seed = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/seed.ts'], { stdio: 'inherit' });
  process.exit(seed.status ?? 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
