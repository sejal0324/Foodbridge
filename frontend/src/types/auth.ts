import type { Role, VerificationStatus } from './common';

export interface OrganizationSummary {
  type: 'DONOR' | 'NGO';
  id: string;
  name: string;
  verificationStatus: VerificationStatus;
}

export interface RepresentativeSummary {
  id: string;
  ngoId: string;
  ngoName: string;
  status: 'INVITED' | 'ACTIVE' | 'INACTIVE' | 'REVOKED' | string;
}

/** GET /api/auth/me (also `data.user` of login/register/refresh/accept-invite). */
export interface Me {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  accountStatus: string;
  adminLevel: string | null;
  organization: OrganizationSummary | null;
  representative: RepresentativeSummary | null;
  createdAt?: string;
}

export interface SessionResponse {
  user: Me;
  accessToken: string;
  accessTokenExpiresAt: string;
}
