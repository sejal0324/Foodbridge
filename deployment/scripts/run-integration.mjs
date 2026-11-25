#!/usr/bin/env node
/**
 * Cross-service integration run (no mocks):
 *   1. rebuilds the *_test database from migrations,
 *   2. provisions a test admin through the server-side CLI,
 *   3. starts the AI service on :8011 and an isolated backend on :5099 against
 *      the test database, with the real job worker,
 *   4. runs tests/integration against them, then stops both.
 * The development database and the dev servers are never touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const testDb = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
if (!testDb || !new URL(testDb).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (ending in _test) is required');

const BACKEND_PORT = '5099';
const AI_PORT = '8011';
const logDir = path.join(os.tmpdir(), 'foodbridge-integration');
mkdirSync(logDir, { recursive: true });
const backendLog = path.join(logDir, 'backend.log');
const admin = { email: 'integration.admin@foodbridge.test', password: 'Integration-pass-2026' };

const baseEnv = { ...process.env, ...env, DATABASE_URL: testDb };
const run = (cmd, args, cwd, extra = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...baseEnv, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log('▶ Rebuilding the test database');
run('npx', ['tsx', '-e', `import('./src/db/migrate.ts').then(async (m) => { await m.migrate({ databaseUrl: process.env.DATABASE_URL, direction: 'down', count: Infinity }); await m.migrate({ databaseUrl: process.env.DATABASE_URL, direction: 'up' }); })`], path.join(root, 'backend'));
console.log('▶ Provisioning the integration admin (server-side CLI)');
run('npx', ['tsx', 'src/cli/create-admin.ts', '--email', admin.email, '--name', 'Integration Admin'], path.join(root, 'backend'), { ADMIN_PASSWORD: admin.password });

const portInUse = async (port) => {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch (err) {
    return err?.cause?.code !== 'ECONNREFUSED';
  }
};
for (const port of [BACKEND_PORT, AI_PORT]) {
  if (await portInUse(port)) {
    console.error(`Port ${port} is already in use (a previous run may still be alive). Stop it and retry.`);
    process.exit(1);
  }
}

const children = [];
const start = (name, cmd, args, cwd, extra, logFile) => {
  // Write straight to a file descriptor: the test run below blocks this process's
  // event loop (spawnSync), so piping through Node streams would stall the logs.
  const fd = openSync(logFile, 'w');
  // Own process group, so stopping it also stops any grandchildren.
  const child = spawn(cmd, args, { cwd, env: { ...baseEnv, ...extra }, stdio: ['ignore', fd, fd], detached: true });
  children.push(child);
  child.on('exit', (code) => code && code !== 143 && console.error(`${name} exited with ${code} (log: ${logFile})`));
};
const stopAll = () =>
  children.forEach((c) => {
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {
      /* already stopped */
    }
  });
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

start('ai', path.join(root, 'ai-service', '.venv', 'bin', 'uvicorn'), ['app.main:app', '--host', '127.0.0.1', '--port', AI_PORT], path.join(root, 'ai-service'), { LLM_PROVIDER: 'none' }, path.join(logDir, 'ai.log'));
start('backend', process.execPath, ['--import', 'tsx', 'src/server.ts'], path.join(root, 'backend'), {
  NODE_ENV: 'development',
  BACKEND_PORT,
  AI_SERVICE_URL: `http://127.0.0.1:${AI_PORT}`,
  EMAIL_PROVIDER: 'log',
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'info',
  UPLOAD_DIR: path.join(logDir, 'uploads'),
}, backendLog);

const wait = async (url) => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
};
await wait(`http://127.0.0.1:${AI_PORT}/ai/health`);
await wait(`http://127.0.0.1:${BACKEND_PORT}/api/health`);
console.log('▶ Services up; running tests/integration');

const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.integration.config.ts'], {
  cwd: path.join(root, 'tests'),
  stdio: 'inherit',
  env: {
    ...process.env,
    API_URL: `http://127.0.0.1:${BACKEND_PORT}/api`,
    AI_URL: `http://127.0.0.1:${AI_PORT}`,
    INTERNAL_SERVICE_TOKEN: env.INTERNAL_SERVICE_TOKEN,
    ADMIN_EMAIL: admin.email,
    ADMIN_PASSWORD: admin.password,
  },
});
stopAll();
process.exit(result.status ?? 1);
