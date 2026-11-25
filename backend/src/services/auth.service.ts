import type { AppConfig } from '../config/env.js';
import type { Database, Queryable } from '../db/database.js';
import { one } from '../db/database.js';
import type { EmailProvider } from '../integrations/email.js';
import type { Logger } from '../config/logger.js';
import { insertDonor, insertNgo, type AddressInput } from '../repositories/organisation.repository.js';
import {
  findSessionByTokenHashForUpdate,
  insertSession,
  revokeAllForUser,
  revokeFamily,
  revokeSession,
} from '../repositories/session.repository.js';
import { findUserByEmail, findUserById, insertUser, loadAuthRow, toAuthContext, type UserRow } from '../repositories/user.repository.js';
import type { Actor, AuthContext, Role } from '../types/auth.js';
import { randomToken, sha256Hex } from '../utils/crypto.js';
import { type AppError, conflict, forbidden, tooManyRequests, unauthorized, unprocessable } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { NotificationService } from './notification.service.js';
import { hashPassword, verifyPassword } from './password.service.js';
import type { TokenService } from './token.service.js';

export interface RegisterInput {
  accountType: 'DONOR' | 'NGO';
  email: string;
  password: string;
  fullName: string;
  phone?: string | undefined;
  organization: {
    name: string;
    businessType?: string | undefined;
    licenseNumber?: string | undefined;
    registrationNumber?: string | undefined;
  } & AddressInput;
}

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

const LOCK_THRESHOLDS = [
  { attempts: 10, minutes: 60 },
  { attempts: 5, minutes: 15 },
];
/** A rotated refresh token presented again within this window is treated as a benign race (e.g. two tabs). */
const ROTATION_GRACE_MS = 10_000;

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationService,
    private readonly email: EmailProvider,
    private readonly logger: Logger,
  ) {}

  /** Registers a donor or NGO. The role is restricted to non-privileged account types; admins are never self-registered. */
  async register(input: RegisterInput, meta: ClientMeta): Promise<{ user: UserRow; tokens: SessionTokens; organizationId: string }> {
    const passwordHash = await hashPassword(input.password);
    let adminNotices: Awaited<ReturnType<NotificationService['notifyAdmins']>> = [];
    const result = await this.db.transaction(async (tx) => {
      const existing = await findUserByEmail(tx, input.email);
      if (existing) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
      const role: Role = input.accountType;
      const user = await insertUser(tx, { email: input.email, passwordHash, role, fullName: input.fullName, phone: input.phone ?? null });
      const org = input.organization;
      const organization =
        role === 'DONOR'
          ? await insertDonor(tx, {
              ...org,
              ownerUserId: user.id,
              businessName: org.name,
              businessType: org.businessType ?? 'RESTAURANT',
              licenseNumber: org.licenseNumber,
              contactEmail: input.email,
              contactPhone: input.phone,
            })
          : await insertNgo(tx, {
              ...org,
              ownerUserId: user.id,
              organizationName: org.name,
              registrationNumber: org.registrationNumber,
              contactEmail: input.email,
              contactPhone: input.phone,
            });
      await tx.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [user.id]);
      const actor: Actor = { type: 'USER', userId: user.id, role, ip: meta.ip, userAgent: meta.userAgent };
      await recordAudit(tx, actor, {
        action: 'auth.registered',
        entityType: role === 'DONOR' ? 'donor' : 'ngo',
        entityId: organization.id,
        metadata: { accountType: role },
      });
      adminNotices = await this.notifications.notifyAdmins(tx, {
        type: 'VERIFICATION_PENDING',
        title: `New ${role === 'DONOR' ? 'donor' : 'NGO'} awaiting verification`,
        body: `${org.name} registered and is waiting for verification.`,
        linkPath: '/admin/verifications',
        dedupeKey: `verification-pending:${organization.id}`,
        data: { organizationType: role, organizationId: organization.id },
      });
      const tokens = await this.createSession(tx, user.id, role, meta);
      return { user, tokens, organizationId: organization.id };
    });
    this.notifications.publish(adminNotices);
    return result;
  }

  async login(emailAddress: string, password: string, meta: ClientMeta): Promise<{ user: UserRow; tokens: SessionTokens }> {
    const user = await findUserByEmail(this.db, emailAddress);
    if (user?.locked_until && user.locked_until > new Date()) {
      throw tooManyRequests('Too many failed sign-in attempts. Please try again later.', 'LOGIN_LOCKED');
    }
    const valid = await verifyPassword(user?.password_hash ?? null, password);
    if (!user || !valid) {
      if (user) await this.recordFailedLogin(user, meta);
      throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
    }
    if (user.account_status === 'SUSPENDED') throw forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    if (user.account_status !== 'ACTIVE') throw forbidden('This account is not active.', 'ACCOUNT_INACTIVE');

    return this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
        [user.id],
      );
      const tokens = await this.createSession(tx, user.id, user.role, meta);
      await recordAudit(tx, { type: 'USER', userId: user.id, role: user.role, ip: meta.ip, userAgent: meta.userAgent }, {
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
      });
      return { user, tokens };
    });
  }

  private async recordFailedLogin(user: UserRow, meta: ClientMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await one<{ failed_login_attempts: number }>(
        tx,
        'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1 RETURNING failed_login_attempts',
        [user.id],
      );
      const attempts = row?.failed_login_attempts ?? 0;
      const rule = LOCK_THRESHOLDS.find((t) => attempts >= t.attempts && attempts % 5 === 0);
      if (rule) {
        await tx.query('UPDATE users SET locked_until = now() + make_interval(mins => $2) WHERE id = $1', [user.id, rule.minutes]);
      }
      await recordAudit(tx, { type: 'USER', userId: null, role: null, ip: meta.ip, userAgent: meta.userAgent }, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { attempts, locked: Boolean(rule) },
      });
    });
  }

  /** Rotates a refresh token. Reuse of an already-rotated token revokes the whole session family. */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<{ tokens: SessionTokens; userId: string }> {
    const outcome = await this.db.transaction(async (tx) => {
      const session = await findSessionByTokenHashForUpdate(tx, sha256Hex(refreshToken));
      if (!session) return { error: unauthorized('Invalid refresh token.', 'INVALID_REFRESH_TOKEN') };
      if (session.revoked_at) {
        const benignRace =
          session.revoked_reason === 'ROTATED' && Date.now() - session.revoked_at.getTime() < ROTATION_GRACE_MS;
        if (session.revoked_reason === 'ROTATED' && !benignRace) {
          const revoked = await revokeFamily(tx, session.family_id, 'REUSE_DETECTED');
          await recordAudit(tx, { type: 'SYSTEM', userId: null, role: null, ip: meta.ip, userAgent: meta.userAgent }, {
            action: 'auth.refresh_token_reuse_detected',
            entityType: 'user',
            entityId: session.user_id,
            metadata: { familyId: session.family_id, sessionsRevoked: revoked },
          });
          return { error: unauthorized('This session is no longer valid. Please sign in again.', 'REFRESH_TOKEN_REUSED') };
        }
        return { error: unauthorized('This session has ended. Please sign in again.', 'SESSION_REVOKED') };
      }
      if (session.expires_at <= new Date()) return { error: unauthorized('This session has expired.', 'SESSION_EXPIRED') };
      const user = await findUserById(tx, session.user_id);
      if (!user || user.account_status !== 'ACTIVE') {
        await revokeSession(tx, session.id, 'ACCOUNT_SUSPENDED');
        return { error: forbidden('This account is not active.', 'ACCOUNT_INACTIVE') };
      }
      const tokens = await this.createSession(tx, user.id, user.role, meta, session.family_id);
      const newSession = await one<{ id: string }>(tx, 'SELECT id FROM user_sessions WHERE refresh_token_hash = $1', [
        sha256Hex(tokens.refreshToken),
      ]);
      await revokeSession(tx, session.id, 'ROTATED', newSession?.id);
      return { tokens, userId: user.id };
    });
    // Revocations above must persist even though the request fails, so errors are thrown after commit.
    if ('error' in outcome) throw outcome.error as AppError;
    return outcome;
  }

  async logout(input: { sessionId?: string | undefined; refreshToken?: string | undefined }, actor: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      let sessionId = input.sessionId;
      if (!sessionId && input.refreshToken) {
        sessionId = (await findSessionByTokenHashForUpdate(tx, sha256Hex(input.refreshToken)))?.id;
      }
      if (!sessionId) return;
      await revokeSession(tx, sessionId, 'LOGOUT');
      await recordAudit(tx, actor, { action: 'auth.logout', entityType: 'session', entityId: sessionId });
    });
  }

  /** Resolves the identity for an access token. Revoked sessions and inactive accounts fail immediately. */
  async authenticate(accessToken: string): Promise<AuthContext> {
    const claims = await this.tokens.verify(accessToken);
    const row = await loadAuthRow(this.db, claims.sessionId, claims.userId);
    if (!row || row.revoked_at) throw unauthorized('This session has ended. Please sign in again.', 'SESSION_REVOKED');
    if (row.expires_at <= new Date()) throw unauthorized('This session has expired.', 'SESSION_EXPIRED');
    if (row.account_status === 'SUSPENDED') throw forbidden('This account is suspended.', 'ACCOUNT_SUSPENDED');
    if (row.account_status !== 'ACTIVE') throw forbidden('This account is not active.', 'ACCOUNT_INACTIVE');
    if (row.role !== claims.role) throw unauthorized('Role changed; please sign in again.', 'SESSION_STALE');
    return toAuthContext(row, claims.sessionId);
  }

  private async createSession(q: Queryable, userId: string, role: Role, meta: ClientMeta, familyId?: string): Promise<SessionTokens> {
    const refreshToken = randomToken(32);
    const refreshTokenExpiresAt = new Date(Date.now() + this.config.auth.refreshTtlDays * 86_400_000);
    const session = await insertSession(q, {
      userId,
      familyId,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: refreshTokenExpiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    });
    const access = await this.tokens.issue({ userId, sessionId: session.id, role });
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken, refreshTokenExpiresAt };
  }

  // -------------------------------------------------------------------------
  // Single-use account tokens: invitations and password resets
  // -------------------------------------------------------------------------

  /** Creates a single-use token (revoking any previous live one for the same purpose). Returns the raw token once. */
  async createAccountToken(q: Queryable, userId: string, purpose: 'INVITE' | 'PASSWORD_RESET', ttlHours: number, createdBy: string | null): Promise<string> {
    await q.query(
      `UPDATE account_tokens SET revoked_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND revoked_at IS NULL`,
      [userId, purpose],
    );
    const token = randomToken(32);
    await q.query(
      `INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
      [userId, purpose, sha256Hex(token), ttlHours, createdBy],
    );
    return token;
  }

  private async consumeAccountToken(q: Queryable, token: string, purpose: 'INVITE' | 'PASSWORD_RESET'): Promise<string> {
    const row = await one<{ user_id: string }>(
      q,
      `UPDATE account_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256Hex(token), purpose],
    );
    if (!row) throw unprocessable('This link is invalid or has expired.', 'INVALID_OR_EXPIRED_TOKEN');
    return row.user_id;
  }

  /** A representative accepts an NGO invitation by choosing a password. */
  async acceptInvite(token: string, password: string, meta: ClientMeta): Promise<{ user: UserRow; tokens: SessionTokens }> {
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const userId = await this.consumeAccountToken(tx, token, 'INVITE');
      const user = await one<UserRow>(
        tx,
        `UPDATE users SET password_hash = $2, account_status = 'ACTIVE', password_changed_at = now(), email_verified_at = COALESCE(email_verified_at, now())
          WHERE id = $1 AND account_status = 'INVITED' RETURNING *`,
        [userId, passwordHash],
      );
      if (!user) throw unprocessable('This invitation has already been used.', 'INVITE_ALREADY_USED');
      await recordAudit(tx, { type: 'USER', userId, role: user.role, ip: meta.ip, userAgent: meta.userAgent }, {
        action: 'auth.invite_accepted',
        entityType: 'user',
        entityId: userId,
      });
      const tokens = await this.createSession(tx, user.id, user.role, meta);
      return { user, tokens };
    });
  }

  /** Always succeeds from the caller's perspective, so it cannot be used to discover accounts. */
  async requestPasswordReset(emailAddress: string): Promise<void> {
    const user = await findUserByEmail(this.db, emailAddress);
    if (!user || user.account_status !== 'ACTIVE') return;
    const token = await this.db.transaction(async (tx) => {
      const t = await this.createAccountToken(tx, user.id, 'PASSWORD_RESET', 1, null);
      await recordAudit(tx, { type: 'SYSTEM', userId: null, role: null }, {
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
      });
      return t;
    });
    if (!this.email.configured) {
      this.logger.warn({ userId: user.id }, 'password reset requested but email delivery is not configured');
      return;
    }
    const link = `${this.config.appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.email
      .send({
        to: user.email,
        subject: 'FoodBridge: reset your password',
        text: `A password reset was requested for your FoodBridge account.\n\nReset it within 1 hour: ${link}\n\nIf you did not request this, ignore this email.`,
      })
      .catch((err: unknown) => this.logger.error({ err, userId: user.id }, 'password reset email failed'));
  }

  async resetPassword(token: string, password: string, meta: ClientMeta): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const userId = await this.consumeAccountToken(tx, token, 'PASSWORD_RESET');
      await tx.query(
        `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
        [userId, passwordHash],
      );
      const revoked = await revokeAllForUser(tx, userId, 'PASSWORD_CHANGED');
      await recordAudit(tx, { type: 'USER', userId, role: null, ip: meta.ip, userAgent: meta.userAgent }, {
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: userId,
        metadata: { sessionsRevoked: revoked },
      });
    });
  }

  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string, actor: Actor): Promise<void> {
    const user = await findUserById(this.db, auth.userId);
    if (!user || !(await verifyPassword(user.password_hash, currentPassword))) {
      throw unauthorized('The current password is incorrect.', 'INVALID_CREDENTIALS');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [auth.userId, passwordHash]);
      // Keep the current session; end every other one.
      await tx.query(
        `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGED'
          WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`,
        [auth.userId, auth.sessionId],
      );
      await recordAudit(tx, actor, { action: 'auth.password_changed', entityType: 'user', entityId: auth.userId });
    });
  }
}
