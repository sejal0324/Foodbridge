/* eslint-disable react-refresh/only-export-components -- route table module, not hot-reloaded */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Outlet, ScrollRestoration } from 'react-router';
import { FullPageLoader, NotFoundPage, RouteError } from '@/components/feedback';
import { AppShell } from '@/layouts/AppShell';
import { AuthLayout } from '@/layouts/AuthLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import { GuestOnly, RequireAuth, RequireRole, RoleHomeRedirect } from './guards';

/*
 * Route map.
 * - Public: /, /login, /register, /forgot-password, /reset-password?token=, /accept-invite?token=
 * - /app redirects to the signed-in user's home.
 * - Role areas are lazy-loaded route modules rendered inside the shared AppShell:
 *     /donor/*  → features/donor/routes.tsx
 *     /ngo/*    → features/ngo/routes.tsx    (NGO stage adds its pages there)
 *     /admin/*  → features/admin/routes.tsx  (admin stage adds its pages there)
 */
const LandingPage = lazy(() => import('@/features/public/LandingPage'));
const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage'));
const RegisterPage = lazy(() => import('@/features/auth/pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/features/auth/pages/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('@/features/auth/pages/AcceptInvitePage'));
const DonorRoutes = lazy(() => import('@/features/donor/routes'));
const NgoRoutes = lazy(() => import('@/features/ngo/routes'));
const AdminRoutes = lazy(() => import('@/features/admin/routes'));

function page(Component: ComponentType, fallback: ReactNode = <FullPageLoader label="Loading…" />) {
  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  );
}

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export function createAppRouter() {
  return createBrowserRouter([
    {
      element: <Root />,
      errorElement: <RouteError />,
      children: [
        { element: <PublicLayout />, children: [{ index: true, element: page(LandingPage) }] },
        {
          element: (
            <GuestOnly>
              <AuthLayout />
            </GuestOnly>
          ),
          children: [
            { path: 'login', element: page(LoginPage) },
            { path: 'register', element: page(RegisterPage) },
            { path: 'forgot-password', element: page(ForgotPasswordPage) },
          ],
        },
        {
          element: <AuthLayout />,
          children: [
            { path: 'reset-password', element: page(ResetPasswordPage) },
            { path: 'accept-invite', element: page(AcceptInvitePage) },
          ],
        },
        {
          element: <RequireAuth />,
          children: [
            { path: 'app', element: <RoleHomeRedirect /> },
            {
              element: <AppShell />,
              children: [
                {
                  path: 'donor/*',
                  element: (
                    <RequireRole roles={['DONOR']}>
                      <DonorRoutes />
                    </RequireRole>
                  ),
                },
                {
                  path: 'ngo/*',
                  element: (
                    <RequireRole roles={['NGO']}>
                      <NgoRoutes />
                    </RequireRole>
                  ),
                },
                {
                  path: 'admin/*',
                  element: (
                    <RequireRole roles={['ADMIN']}>
                      <AdminRoutes />
                    </RequireRole>
                  ),
                },
              ],
            },
          ],
        },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ]);
}
