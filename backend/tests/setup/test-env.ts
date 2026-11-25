import os from 'node:os';
import path from 'node:path';
import { loadEnvFiles } from '../../src/config/env.js';

export const REFERENCE_SNAPSHOT = path.join(os.tmpdir(), 'foodbridge-test-reference.json');

/** Test configuration: always the *_test database, deterministic integrations, no background worker. */
export function applyTestEnv(): void {
  loadEnvFiles();
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL must be set (see .env.example)');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: testUrl,
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    JOB_WORKER_ENABLED: 'false',
    RATE_LIMIT_ENABLED: 'false',
    EMAIL_PROVIDER: 'log',
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: 'http://localhost:5173',
    GOOGLE_MAPS_SERVER_API_KEY: '',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    AI_SERVICE_URL: process.env.TEST_AI_SERVICE_URL ?? 'http://127.0.0.1:1',
    AI_SERVICE_TIMEOUT_MS: '1500',
    UPLOAD_DIR: path.join(os.tmpdir(), 'foodbridge-test-uploads'),
  });
}
