#!/usr/bin/env node
/**
 * Browser end-to-end run against a fully isolated stack (no mocks):
 *   test database (rebuilt + India-wide demo seed) → backend :5098 → AI service :8012
 *   → Vite dev server :5199 (proxying /api and /socket.io) → Playwright (system Chrome).
 * The development database and dev servers are never touched.
 *   node deployment/scripts/run-e2e.mjs [playwright args…]
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

const PORTS = { backend: '5098', ai: '8012', web: '5199' };
const WEB = `http://localhost:${PORTS.web}`;
const logDir = path.join(os.tmpdir(), 'foodbridge-e2e');
mkdirSync(logDir, { recursive: true });
const backendLog = path.join(logDir, 'backend.log');
const baseEnv = { ...process.env, ...env, DATABASE_URL: testDb };

for (const port of Object.values(PORTS)) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    console.error(`Port ${port} is already in use. Stop the previous run and retry.`);
    process.exit(1);
  } catch (err) {
    if (err?.cause?.code !== 'ECONNREFUSED') {
      console.error(`Port ${port} is not free (${err?.cause?.code ?? err}).`);
      process.exit(1);
    }
  }
}

console.log('▶ Rebuilding the test database with the India-wide demo seed');
const reset = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/reset.ts'], { cwd: path.join(root, 'backend'), env: baseEnv, stdio: ['ignore', 'ignore', 'inherit'] });
if (reset.status !== 0) process.exit(reset.status ?? 1);

const children = [];
const start = (cmd, args, cwd, extra, logFile) => {
  const fd = openSync(logFile, 'w');
  const child = spawn(cmd, args, { cwd, env: { ...baseEnv, ...extra }, stdio: ['ignore', fd, fd], detached: true });
  children.push(child);
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

start(path.join(root, 'ai-service', '.venv', 'bin', 'uvicorn'), ['app.main:app', '--host', '127.0.0.1', '--port', PORTS.ai], path.join(root, 'ai-service'), { LLM_PROVIDER: 'none' }, path.join(logDir, 'ai.log'));
start(process.execPath, ['--import', 'tsx', 'src/server.ts'], path.join(root, 'backend'), {
  NODE_ENV: 'development',
  BACKEND_PORT: PORTS.backend,
  AI_SERVICE_URL: `http://127.0.0.1:${PORTS.ai}`,
  CORS_ORIGINS: WEB,
  APP_BASE_URL: WEB,
  EMAIL_PROVIDER: 'log',
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'info',
  UPLOAD_DIR: path.join(logDir, 'uploads'),
}, backendLog);
start(path.join(root, 'frontend', 'node_modules', '.bin', 'vite'), ['--port', PORTS.web, '--strictPort'], path.join(root, 'frontend'), { FOODBRIDGE_API_PROXY_TARGET: `http://127.0.0.1:${PORTS.backend}` }, path.join(logDir, 'web.log'));

const wait = async (url) => {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url} (logs in ${logDir})`);
};
await wait(`http://127.0.0.1:${PORTS.ai}/ai/health`);
await wait(`http://127.0.0.1:${PORTS.backend}/api/health`);
await wait(`${WEB}/api/health`);
console.log(`▶ Stack up (web ${WEB}); running Playwright`);

const result = spawnSync(path.join(root, 'tests', 'node_modules', '.bin', 'playwright'), ['test', '--config', 'playwright.config.ts', ...process.argv.slice(2)], {
  cwd: path.join(root, 'tests'),
  stdio: 'inherit',
  env: { ...process.env, E2E_BASE_URL: WEB, E2E_API_URL: `http://127.0.0.1:${PORTS.backend}/api` },
});
stopAll();
process.exit(result.status ?? 1);
