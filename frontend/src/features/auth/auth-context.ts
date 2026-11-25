import { createContext, useContext } from 'react';
import type { Me, Role } from '@/types';
import type { RegisterInput } from './schemas';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: Me | null;
  login: (email: string, password: string) => Promise<Me>;
  register: (input: RegisterInput) => Promise<Me>;
  acceptInvite: (token: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  /** Re-reads GET /auth/me (e.g. after the organisation's verification status changes). */
  reloadUser: () => Promise<Me | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user (throws if called outside an authenticated area). */
export function useCurrentUser(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser requires an authenticated user');
  return user;
}

export const ROLE_HOME: Record<Role, string> = { DONOR: '/donor', NGO: '/ngo', ADMIN: '/admin' };

export function homePathFor(user: Pick<Me, 'role'> | null): string {
  return user ? ROLE_HOME[user.role] : '/login';
}

/** True when the user's organisation exists and is APPROVED (admins: always). */
export function isOrganisationApproved(user: Me | null): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.organization) return user.organization.verificationStatus === 'APPROVED';
  // NGO representatives act for an NGO that must be approved; the backend enforces it.
  return user.representative?.status === 'ACTIVE';
}
