#!/usr/bin/env node
/**
 * One-time local setup (idempotent):
 *  1. creates .env from .env.example with freshly generated secrets (if missing)
 *  2. installs root, backend and frontend npm dependencies
 *  3. creates ai-service/.venv (Python 3.12 via uv) and installs requirements
 *  4. starts PostgreSQL + PostGIS in Docker and waits until healthy
 *  5. applies database migrations
 *  6. loads development demo data if the database is empty (skip with --no-seed)
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const noSeed = process.argv.includes('--no-seed');

function run(label, cmd, args, cwd = root, { optional = false } = {}) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    if (optional) {
      console.warn(`  (skipped: ${label} failed)`);
      return false;
    }
    console.error(`✖ ${label} failed.`);
    process.exit(r.status ?? 1);
  }
  return true;
}

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n')[0].trim() : null;
}

// 1. Environment file with generated secrets.
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) {
  const password = randomBytes(24).toString('hex');
  let env = readFileSync(path.join(root, '.env.example'), 'utf8').replaceAll('replace-with-a-generated-password', password);
  env = env.replace(/replace-with-a-generated-secret/g, () => randomBytes(48).toString('base64url'));
  writeFileSync(envPath, env);
  chmodSync(envPath, 0o600);
  console.log('✔ Created .env with generated local secrets (never commit it).');
} else {
  console.log('✔ .env already exists — keeping it.');
}

// 2. Node dependencies.
run('Installing root dependencies', 'npm', ['install']);
run('Installing backend dependencies', 'npm', ['install'], path.join(root, 'backend'));
run('Installing frontend dependencies', 'npm', ['install'], path.join(root, 'frontend'));

// 3. Python environment for the AI service.
const ai = path.join(root, 'ai-service');
let uv = which('uv') ?? (existsSync(path.join(os.homedir(), '.local', 'bin', 'uv')) ? path.join(os.homedir(), '.local', 'bin', 'uv') : null);
if (!uv) {
  run('Installing uv (Python package manager) for this user', 'python3', ['-m', 'pip', 'install', '--user', 'uv']);
  uv = path.join(os.homedir(), '.local', 'bin', 'uv');
}
if (!existsSync(path.join(ai, '.venv'))) run('Creating ai-service/.venv (Python 3.12)', uv, ['venv', '--python', '3.12', '.venv'], ai);
run('Installing AI service requirements', uv, ['pip', 'install', '--python', '.venv/bin/python', '-r', 'requirements.txt', '-r', 'requirements-dev.txt'], ai);

// 4–6. Database.
run('Starting PostgreSQL + PostGIS (Docker)', 'docker', ['compose', 'up', '-d', '--wait', 'db']);
run('Applying database migrations', 'npm', ['--prefix', 'backend', 'run', 'db:migrate']);
if (!noSeed) run('Loading development demo data (skipped if the database already has users)', 'npm', ['--prefix', 'backend', 'run', 'db:seed'], root, { optional: true });

console.log(`
✔ Setup complete.

  Start everything:   npm run dev
  Frontend:           http://localhost:5173
  Backend API:        http://localhost:5001/api/health
  AI service:         http://localhost:8001/ai/health
`);
