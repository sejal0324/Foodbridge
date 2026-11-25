import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageLoader } from '@/components/feedback';
import { homePathFor, useAuth } from '@/features/auth/auth-context';
import type { Role } from '@/types';

/**
 * Route guards. They only shape navigation: the backend enforces every
 * permission, so hiding a route is never the security boundary.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <>{children ?? <Outlet />}</>;
}

/** Sends users whose role is not allowed to their own home (e.g. a donor opening /ngo → /donor). */
export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homePathFor(user)} replace />;
  return <>{children ?? <Outlet />}</>;
}

/** Login/register pages: signed-in users go to where they came from, or their home. */
export function GuestOnly({ children }: { children?: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated' && user) {
    const from = (location.state as { from?: string } | null)?.from;
    const target = from && from.startsWith(homePathFor(user)) ? from : homePathFor(user);
    return <Navigate to={target} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

/** /app → the signed-in user's home. */
export function RoleHomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homePathFor(user)} replace />;
}
