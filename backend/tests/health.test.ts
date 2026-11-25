import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('health and HTTP foundation', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await h.http.get('/api/health').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reports readiness with the database check and honest integration status', async () => {
    const res = await h.http.get('/api/health/ready').expect(200);
    expect(res.body.data.checks.database).toBe('ok');
    expect(res.body.data.integrations.payments).toBe('not_configured');
    expect(res.body.data.integrations.maps).toBe('not_configured');
    expect(Object.keys(res.body.data.integrations).sort()).toEqual(['email', 'maps', 'payments']);
  });

  it('echoes a well-formed X-Request-Id and replaces malformed ones', async () => {
    const good = await h.http.get('/api/health').set('X-Request-Id', 'abc12345-test').expect(200);
    expect(good.headers['x-request-id']).toBe('abc12345-test');
    const bad = await h.http.get('/api/health').set('X-Request-Id', 'bad id with spaces <script>').expect(200);
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await h.http.get('/api/does-not-exist').expect(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('rejects malformed JSON with 400 and oversized bodies with 413', async () => {
    const malformed = await h.http.post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
    expect(malformed.body.error.code).toBe('MALFORMED_JSON');
    const big = await h.http.post('/api/auth/login').send({ email: 'x@example.org', password: 'a'.repeat(300_000) }).expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and never advertises the framework', async () => {
    const res = await h.http.get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
  });

  it('only allows configured CORS origins', async () => {
    const allowed = await h.http.get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await h.http.get('/api/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
