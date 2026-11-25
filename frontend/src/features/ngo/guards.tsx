import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useCurrentUser } from '@/features/auth/auth-context';
import { ApprovalGate } from '@/features/profile/components/VerificationBanner';
import { isNgoOwner } from './access';

/** State passed to the overview when a representative opens an owner-only page. */
export interface OwnerOnlyRedirectState {
  ownerOnly: true;
}

/**
 * Pages for the NGO owner account only (marketplace, assistance, collections,
 * billing…). Representative-only accounts are sent to the NGO overview, which
 * explains why. Navigation only: the backend enforces every permission.
 */
export function RequireNgoOwner({ children }: { children?: ReactNode }) {
  const user = useCurrentUser();
  if (!isNgoOwner(user)) return <Navigate to="/ngo" replace state={{ ownerOnly: true } satisfies OwnerOnlyRedirectState} />;
  return <>{children ?? <Outlet />}</>;
}

/** Owner page that needs an APPROVED organisation (the shared ApprovalGate explains otherwise). */
export function NgoApproved({ feature, children }: { feature: string; children: ReactNode }) {
  const user = useCurrentUser();
  return (
    <ApprovalGate user={user} feature={feature}>
      {children}
    </ApprovalGate>
  );
}
