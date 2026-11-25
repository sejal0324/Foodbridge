import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (backend/src/config or backend/dist/config → three levels up). */
export const REPO_ROOT = path.resolve(here, '../../..');

/**
 * Loads the repository-root `.env` for local development. Variables that are
 * already present in the environment always win, so tests and hosting
 * platforms can override anything.
 */
export function loadEnvFiles(): void {
  const file = path.join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const secret = z.string().min(32, 'must be at least 32 characters');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(5001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  APP_BASE_URL: z.url().default('http://localhost:5173'),
  TRUST_PROXY: bool(false),
  DEFAULT_DISPLAY_TIMEZONE: z.string().default('Asia/Kolkata'),

  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  JWT_ACCESS_SECRET: secret,
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  COOKIE_SECURE: optionalString,

  INTERNAL_SERVICE_TOKEN: secret,
  AI_SERVICE_URL: z.url().default('http://localhost:8001'),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  AI_ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),

  GOOGLE_MAPS_SERVER_API_KEY: optionalString,

  EMAIL_PROVIDER: z.enum(['none', 'smtp', 'log']).default('none'),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: optionalString,

  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,

  UPLOAD_DIR: optionalString,
  LOCATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AI_INTERACTION_RETENTION_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  JOB_WORKER_ENABLED: bool(true),
  RATE_LIMIT_ENABLED: bool(true),
});

export type RawEnv = z.infer<typeof schema>;

export interface AppConfig {
  env: RawEnv['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  port: number;
  logLevel: RawEnv['LOG_LEVEL'];
  corsOrigins: string[];
  appBaseUrl: string;
  trustProxy: boolean;
  defaultTimezone: string;
  database: { url: string; poolMax: number };
  auth: {
    accessSecret: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
    cookieSecure: boolean;
  };
  ai: { url: string; token: string; timeoutMs: number; assistantTimeoutMs: number };
  maps: { serverApiKey: string | undefined };
  email: {
    provider: RawEnv['EMAIL_PROVIDER'];
    smtp: { host?: string; port: number; user?: string; password?: string };
    from: string | undefined;
  };
  razorpay: { keyId?: string; keySecret?: string; webhookSecret?: string; enabled: boolean };
  uploadDir: string;
  retention: { locationDays: number; aiInteractionDays: number };
  jobs: { workerEnabled: boolean };
  rateLimitEnabled: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const PLACEHOLDER = /replace-with/i;

export function parseConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const problems: string[] = [];
  const isProduction = e.NODE_ENV === 'production';

  for (const key of ['JWT_ACCESS_SECRET', 'INTERNAL_SERVICE_TOKEN'] as const) {
    if (PLACEHOLDER.test(e[key])) problems.push(`${key}: still contains a placeholder value`);
  }

  const cookieSecure = e.COOKIE_SECURE === undefined ? isProduction : e.COOKIE_SECURE === 'true';
  const corsOrigins = e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

  if (isProduction) {
    if (!cookieSecure) problems.push('COOKIE_SECURE must be true in production');
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS must not contain * in production');
    if (e.EMAIL_PROVIDER === 'log') problems.push('EMAIL_PROVIDER=log is development-only');
  }
  if (e.NODE_ENV === 'test') {
    const dbName = new URL(e.DATABASE_URL).pathname.replace(/^\//, '');
    if (!dbName.endsWith('_test')) {
      problems.push(`NODE_ENV=test requires a database whose name ends in "_test" (got "${dbName}")`);
    }
  }
  if (e.EMAIL_PROVIDER === 'smtp' && (!e.SMTP_HOST || !e.EMAIL_FROM)) {
    problems.push('EMAIL_PROVIDER=smtp requires SMTP_HOST and EMAIL_FROM');
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    env: e.NODE_ENV,
    isProduction,
    isTest: e.NODE_ENV === 'test',
    port: e.BACKEND_PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigins,
    appBaseUrl: e.APP_BASE_URL.replace(/\/$/, ''),
    trustProxy: e.TRUST_PROXY,
    defaultTimezone: e.DEFAULT_DISPLAY_TIMEZONE,
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    auth: {
      accessSecret: e.JWT_ACCESS_SECRET,
      accessTtlSeconds: e.JWT_ACCESS_TTL_SECONDS,
      refreshTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      cookieSecure,
    },
    ai: {
      url: e.AI_SERVICE_URL.replace(/\/$/, ''),
      token: e.INTERNAL_SERVICE_TOKEN,
      timeoutMs: e.AI_SERVICE_TIMEOUT_MS,
      assistantTimeoutMs: e.AI_ASSISTANT_TIMEOUT_MS,
    },
    maps: { serverApiKey: e.GOOGLE_MAPS_SERVER_API_KEY },
    email: {
      provider: e.EMAIL_PROVIDER,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, password: e.SMTP_PASSWORD },
      from: e.EMAIL_FROM,
    },
    razorpay: {
      keyId: e.RAZORPAY_KEY_ID,
      keySecret: e.RAZORPAY_KEY_SECRET,
      webhookSecret: e.RAZORPAY_WEBHOOK_SECRET,
      enabled: Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET),
    },
    uploadDir: path.resolve(e.UPLOAD_DIR ?? path.join(REPO_ROOT, 'uploads')),
    retention: { locationDays: e.LOCATION_RETENTION_DAYS, aiInteractionDays: e.AI_INTERACTION_RETENTION_DAYS },
    jobs: { workerEnabled: e.JOB_WORKER_ENABLED },
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
  };
}
