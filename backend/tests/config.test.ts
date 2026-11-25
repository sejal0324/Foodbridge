import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config/env.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5433/foodbridge',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  INTERNAL_SERVICE_TOKEN: 'c'.repeat(40),
};

describe('configuration validation', () => {
  it('accepts a minimal valid development config with safe defaults', () => {
    const c = parseConfig(base);
    expect(c.port).toBe(5001);
    expect(c.auth.cookieSecure).toBe(false);
    expect(c.razorpay.enabled).toBe(false);
  });

  it('rejects missing and short secrets', () => {
    expect(() => parseConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...base, INTERNAL_SERVICE_TOKEN: undefined })).toThrow(ConfigError);
  });

  it('rejects placeholder secrets copied from .env.example', () => {
    expect(() => parseConfig({ ...base, JWT_ACCESS_SECRET: 'replace-with-a-generated-secret-xxxxxxxxxxxx' })).toThrow(/placeholder/);
  });

  it('ignores the removed OTP/SMS settings left in an older .env', () => {
    const legacy = { OTP_HMAC_SECRET: 'replace-with-a-generated-secret', OTP_DEV_MODE: 'true', SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: '' };
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', ...legacy })).not.toThrow();
    expect(parseConfig({ ...base, ...legacy })).not.toHaveProperty('otp');
  });

  it('requires secure cookies and no wildcard CORS in production', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
    expect(parseConfig({ ...base, NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
  });

  it('refuses to run tests against a non-test database', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'test' })).toThrow(/_test/);
  });

  it('enables Razorpay only when every credential is present', () => {
    expect(parseConfig({ ...base, RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }).razorpay.enabled).toBe(false);
    expect(
      parseConfig({ ...base, RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' }).razorpay.enabled,
    ).toBe(true);
  });
});
