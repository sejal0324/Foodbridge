import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, approve, createAdmin, registerDonor, registerNgo } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => {
  h ??= await createHarness();
  await resetDatabase(h.ctx.db);
});
afterAll(() => h.close());

const auditCount = async (action: string) =>
  (await h.ctx.db.query<{ n: number }>('SELECT count(*) AS n FROM audit_logs WHERE action = $1', [action])).rows[0]?.n ?? 0;

describe('registration', () => {
  it('registers a donor with a PENDING organisation and notifies admins', async () => {
    const admin = await createAdmin(h);
    const donor = await registerDonor(h);
    const me = await h.http.get('/api/auth/me').set(donor.auth).expect(200);
    expect(me.body.data).toMatchObject({ role: 'DONOR', organization: { type: 'DONOR', verificationStatus: 'PENDING' } });
    const notes = await h.http.get('/api/notifications').set(admin.auth).expect(200);
    expect(notes.body.data[0].type).toBe('VERIFICATION_PENDING');
    expect(await auditCount('auth.registered')).toBe(1);
  });

  it('registers an NGO and stores a hashed password (never the raw one)', async () => {
    const ngo = await registerNgo(h);
    const row = await h.ctx.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [ngo.userId]);
    expect(row.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.rows[0]?.password_hash).not.toContain(PASSWORD);
  });

  it('never allows public admin registration', async () => {
    const res = await h.http
      .post('/api/auth/register')
      .send({ accountType: 'ADMIN', email: 'evil@example.org', password: PASSWORD, fullName: 'Evil', organization: { name: 'X' } })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores a client-supplied role field', async () => {
    const res = await h.http
      .post('/api/auth/register')
      .send({ accountType: 'DONOR', role: 'ADMIN', email: 'sneaky@example.org', password: PASSWORD, fullName: 'Sneaky Person', organization: { name: 'Cafe' } })
      .expect(201);
    expect(res.body.data.user.role).toBe('DONOR');
  });

  it('rejects duplicate emails (case-insensitive) and weak passwords', async () => {
    await registerDonor(h, { email: 'dup@example.org' });
    const dup = await h.http
      .post('/api/auth/register')
      .send({ accountType: 'NGO', email: 'DUP@example.org', password: PASSWORD, fullName: 'Someone Else', organization: { name: 'Org' } })
      .expect(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    const weak = await h.http
      .post('/api/auth/register')
      .send({ accountType: 'NGO', email: 'weak@example.org', password: 'short', fullName: 'Weak Pw', organization: { name: 'Org' } })
      .expect(422);
    expect(weak.body.error.details.some((d: { path: string }) => d.path === 'password')).toBe(true);
  });
});

describe('login, tokens and sessions', () => {
  it('logs in with valid credentials and rejects invalid ones with a generic message', async () => {
    const donor = await registerDonor(h);
    const ok = await h.http.post('/api/auth/login').send({ email: donor.email, password: PASSWORD }).expect(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    const cookie = ok.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    const wrong = await h.http.post('/api/auth/login').send({ email: donor.email, password: 'Wrong-pass-999' }).expect(401);
    const unknown = await h.http.post('/api/auth/login').send({ email: 'nobody@example.org', password: 'Wrong-pass-999' }).expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after 5 failed attempts', async () => {
    const donor = await registerDonor(h);
    for (let i = 0; i < 5; i++) await h.http.post('/api/auth/login').send({ email: donor.email, password: 'Wrong-pass-999' }).expect(401);
    const locked = await h.http.post('/api/auth/login').send({ email: donor.email, password: PASSWORD }).expect(429);
    expect(locked.body.error.code).toBe('LOGIN_LOCKED');
  });

  it('rejects requests without, or with tampered, access tokens', async () => {
    await h.http.get('/api/auth/me').expect(401);
    const donor = await registerDonor(h);
    const [head, payload, sig] = donor.accessToken.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload as string, 'base64url').toString()), role: 'ADMIN' })).toString('base64url');
    const res = await h.http.get('/api/auth/me').set('Authorization', `Bearer ${head}.${forged}.${sig}`).expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects expired access tokens with TOKEN_EXPIRED', async () => {
    const donor = await registerDonor(h);
    const { TokenService } = await import('../src/services/token.service.js');
    const shortLived = new TokenService(h.config.auth.accessSecret, -10);
    const session = await h.ctx.db.query<{ id: string }>('SELECT id FROM user_sessions WHERE user_id = $1', [donor.userId]);
    const { token } = await shortLived.issue({ userId: donor.userId, sessionId: session.rows[0]?.id as string, role: 'DONOR' });
    const res = await h.http.get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rotates refresh tokens and detects reuse of a rotated token', async () => {
    const donor = await registerDonor(h);
    const first = await h.http.post('/api/auth/refresh').set('Cookie', donor.refreshCookie).expect(200);
    const newCookie = (first.headers['set-cookie']?.[0] ?? '').split(';')[0] as string;
    expect(newCookie).not.toBe(donor.refreshCookie);
    // Reusing the old token after the grace window revokes the whole family.
    await h.ctx.db.query(`UPDATE user_sessions SET revoked_at = now() - interval '1 minute' WHERE revoked_reason = 'ROTATED'`);
    const reuse = await h.http.post('/api/auth/refresh').set('Cookie', donor.refreshCookie).expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    const after = await h.http.post('/api/auth/refresh').set('Cookie', newCookie).expect(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
    expect(await auditCount('auth.refresh_token_reuse_detected')).toBe(1);
  });

  it('rejects refresh from a disallowed browser origin', async () => {
    const donor = await registerDonor(h);
    const res = await h.http.post('/api/auth/refresh').set('Cookie', donor.refreshCookie).set('Origin', 'https://evil.example').expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('logout revokes the session immediately, including the outstanding access token', async () => {
    const donor = await registerDonor(h);
    await h.http.post('/api/auth/logout').set(donor.auth).set('Cookie', donor.refreshCookie).expect(204);
    const me = await h.http.get('/api/auth/me').set(donor.auth).expect(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    await h.http.post('/api/auth/refresh').set('Cookie', donor.refreshCookie).expect(401);
  });

  it('suspending a user blocks them on their very next request', async () => {
    const admin = await createAdmin(h);
    const donor = await registerDonor(h);
    await h.http.patch(`/api/admin/users/${donor.userId}/status`).set(admin.auth).send({ status: 'SUSPENDED', reason: 'abuse' }).expect(204);
    await h.http.get('/api/auth/me').set(donor.auth).expect(401);
    const login = await h.http.post('/api/auth/login').send({ email: donor.email, password: PASSWORD }).expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await h.http.patch(`/api/admin/users/${admin.userId}/status`).set(admin.auth).send({ status: 'SUSPENDED' }).expect(422);
  });

  it('password reset is single-use, revokes sessions and never reveals whether an email exists', async () => {
    const donor = await registerDonor(h);
    await h.http.post('/api/auth/password-reset/request').send({ email: 'nobody@example.org' }).expect(202);
    await h.http.post('/api/auth/password-reset/request').send({ email: donor.email }).expect(202);
    const mail = h.devEmail.outbox.at(-1);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail?.text ?? '')?.[1] ?? '');
    expect(token.length).toBeGreaterThan(20);
    await h.http.post('/api/auth/password-reset/confirm').send({ token, password: 'N3w-password-456' }).expect(204);
    await h.http.post('/api/auth/password-reset/confirm').send({ token, password: 'N3w-password-789' }).expect(422);
    await h.http.get('/api/auth/me').set(donor.auth).expect(401);
    await h.http.post('/api/auth/login').send({ email: donor.email, password: 'N3w-password-456' }).expect(200);
  });
});

describe('role-based and verification-based authorization', () => {
  it('blocks non-admins from admin endpoints and other roles from role-specific endpoints', async () => {
    const donor = await registerDonor(h);
    const ngo = await registerNgo(h);
    await h.http.get('/api/admin/users').set(donor.auth).expect(403);
    await h.http.get('/api/admin/verifications').set(ngo.auth).expect(403);
    await h.http.get('/api/donors/me').set(ngo.auth).expect(403);
    await h.http.get('/api/ngos/me').set(donor.auth).expect(403);
  });

  it('admin approves organisations; the owner is notified and the decision is audited', async () => {
    const admin = await createAdmin(h);
    const ngo = await registerNgo(h);
    const queue = await h.http.get('/api/admin/verifications?type=NGO').set(admin.auth).expect(200);
    expect(queue.body.data.map((a: { id: string }) => a.id)).toContain(ngo.orgId);
    await h.http.patch(`/api/admin/organizations/ngo/${ngo.orgId}/verification`).set(admin.auth).send({ status: 'REJECTED' }).expect(400);
    await approve(h, admin, 'ngo', ngo.orgId);
    const me = await h.http.get('/api/auth/me').set(ngo.auth).expect(200);
    expect(me.body.data.organization.verificationStatus).toBe('APPROVED');
    const notes = await h.http.get('/api/notifications').set(ngo.auth).expect(200);
    expect(notes.body.data.some((n: { type: string }) => n.type === 'VERIFICATION_APPROVED')).toBe(true);
    expect(await auditCount('verification.approved')).toBe(1);
  });

  it('suspending an organisation revokes its owner sessions', async () => {
    const admin = await createAdmin(h);
    const donor = await registerDonor(h);
    await approve(h, admin, 'donor', donor.orgId);
    await h.http.patch(`/api/admin/organizations/donor/${donor.orgId}/verification`).set(admin.auth).send({ status: 'SUSPENDED', notes: 'policy' }).expect(204);
    await h.http.get('/api/auth/me').set(donor.auth).expect(401);
  });
});
