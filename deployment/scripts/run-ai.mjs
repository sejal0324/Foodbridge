#!/usr/bin/env node
/**
 * Runs AI-service commands with the project's Python virtual environment.
 *   node deployment/scripts/run-ai.mjs            → uvicorn on :8001
 *   node deployment/scripts/run-ai.mjs --reload   → uvicorn with auto-reload (development)
 *   node deployment/scripts/run-ai.mjs --pytest   → test suite
 *   node deployment/scripts/run-ai.mjs --ruff     → linter
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const service = path.join(root, 'ai-service');
const bin = path.join(service, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
if (!existsSync(bin)) {
  console.error('ai-service/.venv not found. Run `npm run setup` first.');
  process.exit(1);
}
const args = process.argv.slice(2);
let cmd;
let cmdArgs;
if (args.includes('--pytest')) [cmd, cmdArgs] = [path.join(bin, 'python'), ['-m', 'pytest', '-q']];
else if (args.includes('--ruff')) [cmd, cmdArgs] = [path.join(bin, 'ruff'), ['check', '.']];
else {
  const port = process.env.AI_SERVICE_PORT ?? '8001';
  cmd = path.join(bin, 'uvicorn');
  cmdArgs = ['app.main:app', '--host', '127.0.0.1', '--port', port, ...(args.includes('--reload') ? ['--reload'] : [])];
}
const result = spawnSync(cmd, cmdArgs, { cwd: service, stdio: 'inherit' });
process.exit(result.status ?? 1);
