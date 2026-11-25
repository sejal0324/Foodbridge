import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { actorFrom, requireAuth } from '../middleware/request-context.js';
import type { AuthService, SessionTokens } from '../services/auth.service.js';
import type { ProfileService } from '../services/profile.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { created, noContent, ok } from '../utils/http.js';
import {
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registerSchema,
} from '../validators/auth.validators.js';
import { parseBody } from '../validators/common.js';

export const REFRESH_COOKIE = 'fb_refresh';

export function authController(auth: AuthService, profiles: ProfileService, config: AppConfig) {
  const cookieOptions = (expires?: Date): CookieOptions => ({
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'strict',
    path: '/api/auth',
    ...(expires ? { expires } : {}),
  });

  const meta = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent') });

  const sendSession = (res: Response, tokens: SessionTokens, body: Record<string, unknown>, status = 200) => {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(tokens.refreshTokenExpiresAt));
    const payload = { ...body, accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt };
    return status === 201 ? created(res, payload) : ok(res, payload);
  };

  /** Cookie-authenticated endpoints must come from an allowed browser origin (CSRF defence in depth). */
  const assertAllowedOrigin = (req: Request) => {
    const origin = req.header('origin');
    if (origin && !config.corsOrigins.includes(origin)) throw forbidden('Request origin not allowed.', 'ORIGIN_NOT_ALLOWED');
  };

  return {
    async register(req: Request, res: Response) {
      const input = parseBody(registerSchema, req);
      const result = await auth.register(input, meta(req));
      const me = await profiles.me(await auth.authenticate(result.tokens.accessToken));
      return sendSession(res, result.tokens, { user: me }, 201);
    },

    async login(req: Request, res: Response) {
      const { email, password } = parseBody(loginSchema, req);
      const { tokens } = await auth.login(email, password, meta(req));
      const me = await profiles.me(await auth.authenticate(tokens.accessToken));
      return sendSession(res, tokens, { user: me });
    },

    async refresh(req: Request, res: Response) {
      assertAllowedOrigin(req);
      const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
      if (!token) throw unauthorized('No active session.', 'NO_REFRESH_TOKEN');
      try {
        const { tokens } = await auth.refresh(token, meta(req));
        const me = await profiles.me(await auth.authenticate(tokens.accessToken));
        return sendSession(res, tokens, { user: me });
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, cookieOptions());
        throw err;
      }
    },

    async logout(req: Request, res: Response) {
      assertAllowedOrigin(req);
      await auth.logout(
        { sessionId: req.auth?.sessionId, refreshToken: req.cookies?.[REFRESH_COOKIE] as string | undefined },
        actorFrom(req),
      );
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      return noContent(res);
    },

    async me(req: Request, res: Response) {
      return ok(res, await profiles.me(requireAuth(req)));
    },

    async acceptInvite(req: Request, res: Response) {
      const { token, password } = parseBody(acceptInviteSchema, req);
      const { tokens } = await auth.acceptInvite(token, password, meta(req));
      const me = await profiles.me(await auth.authenticate(tokens.accessToken));
      return sendSession(res, tokens, { user: me });
    },

    async requestPasswordReset(req: Request, res: Response) {
      const { email } = parseBody(passwordResetRequestSchema, req);
      await auth.requestPasswordReset(email);
      return res.status(202).json({ data: { message: 'If an account exists for this email, a reset link has been sent.' } });
    },

    async resetPassword(req: Request, res: Response) {
      const { token, password } = parseBody(passwordResetSchema, req);
      await auth.resetPassword(token, password, meta(req));
      return noContent(res);
    },

    async changePassword(req: Request, res: Response) {
      const { currentPassword, newPassword } = parseBody(changePasswordSchema, req);
      await auth.changePassword(requireAuth(req), currentPassword, newPassword, actorFrom(req));
      return noContent(res);
    },
  };
}
