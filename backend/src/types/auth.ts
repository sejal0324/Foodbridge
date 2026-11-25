export const ROLES = ['DONOR', 'NGO', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

/**
 * Identity of an authenticated request. Derived exclusively from the verified
 * session and the database, never from client-supplied fields.
 */
export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  email: string;
  fullName: string;
  /** Donor organisation owned by this user (role DONOR). */
  donorId: string | null;
  donorStatus: VerificationStatus | null;
  /** NGO owned by this user (role NGO, owner). */
  ngoId: string | null;
  ngoStatus: VerificationStatus | null;
  /** Representative record of this user (role NGO, may also be the owner). */
  representativeId: string | null;
  representativeNgoId: string | null;
  representativeActive: boolean;
  adminLevel: 'SUPER_ADMIN' | 'ADMIN' | null;
}

export type ActorType = 'USER' | 'SYSTEM' | 'SERVICE';

/** Who performs a state change; recorded in audit logs and histories. */
export interface Actor {
  type: ActorType;
  userId: string | null;
  role: Role | null;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', userId: null, role: null };

/**
 * The NGO whose data this user may see: their own NGO, or (for a representative) the NGO that
 * authorised them, but only while that authorisation is ACTIVE. Revoked or inactive
 * representatives get no NGO-wide scope.
 */
export function scopedNgoId(auth: Pick<AuthContext, 'ngoId' | 'representativeNgoId' | 'representativeActive'>): string | null {
  return auth.ngoId ?? (auth.representativeActive ? auth.representativeNgoId : null);
}
