import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner, type RunnerOption } from 'node-pg-migrate';
import { REPO_ROOT, loadEnvFiles } from '../config/env.js';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';

export interface MigrateOptions {
  databaseUrl: string;
  direction: 'up' | 'down';
  /** Number of migrations to run; Infinity for all. */
  count?: number;
  log?: (msg: string) => void;
}

/** Runs SQL migrations from database/migrations. Each migration runs in its own transaction. */
export async function migrate({ databaseUrl, direction, count, log }: MigrateOptions): Promise<string[]> {
  const options: RunnerOption = {
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction,
    count: count ?? (direction === 'up' ? Infinity : 1),
    checkOrder: true,
    log: log ?? (() => undefined),
  };
  const applied = await runner(options);
  return applied.map((m) => m.name);
}

// CLI: tsx src/db/migrate.ts <up|down|redo> [count] [--test]
async function main(): Promise<void> {
  loadEnvFiles();
  const [command = 'up', countArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const useTest = process.argv.includes('--test');
  const databaseUrl = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set`);
  const target = new URL(databaseUrl);
  const label = `${target.hostname}:${target.port}${target.pathname}`;
  const count = countArg === undefined ? undefined : countArg === 'all' ? Infinity : Number.parseInt(countArg, 10);
  const log = (msg: string) => console.log(msg);

  if (command === 'up' || command === 'down') {
    const names = await migrate({ databaseUrl, direction: command, count, log });
    console.log(`[${label}] ${command}: ${names.length === 0 ? 'nothing to do' : names.join(', ')}`);
  } else if (command === 'redo') {
    await migrate({ databaseUrl, direction: 'down', count: count ?? 1, log });
    await migrate({ databaseUrl, direction: 'up', count: count ?? 1, log });
    console.log(`[${label}] redo complete`);
  } else {
    throw new Error(`Unknown command "${command}". Use up | down | redo.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
