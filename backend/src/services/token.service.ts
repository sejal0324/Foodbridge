import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Role } from '../types/auth.js';
import { ROLES } from '../types/auth.js';
import { unauthorized } from '../utils/errors.js';

const ISSUER = 'foodbridge-api';
const AUDIENCE = 'foodbridge-app';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  role: Role;
}

/** Short-lived HS256 access tokens. Identity is re-checked against the database on every request. */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const token = await new SignJWT({ sid: claims.sessionId, role: claims.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const role = payload.role;
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || !ROLES.includes(role as Role)) {
        throw unauthorized('Invalid access token.', 'INVALID_TOKEN');
      }
      return { userId: payload.sub, sessionId: payload.sid, role: role as Role };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw unauthorized('The access token has expired.', 'TOKEN_EXPIRED');
      if (err instanceof Error && err.name === 'AppError') throw err;
      throw unauthorized('Invalid access token.', 'INVALID_TOKEN');
    }
  }
}
