import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { RequireRole } from '@/app/guards';
import { NotFoundPage } from '@/components/feedback';

const AdminOverviewPage = lazy(() => import('./pages/AdminOverviewPage'));
const VerificationsPage = lazy(() => import('./pages/VerificationsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AdminDonationsPage = lazy(() => import('./pages/AdminDonationsPage'));
const AdminDonationDetailPage = lazy(() => import('./pages/AdminDonationDetailPage'));
const AdminAssistancePage = lazy(() => import('./pages/AdminAssistancePage'));
const AdminAssistanceDetailPage = lazy(() => import('./pages/AdminAssistanceDetailPage'));
const AdminPickupsPage = lazy(() => import('./pages/AdminPickupsPage'));
const AdminPickupDetailPage = lazy(() => import('./pages/AdminPickupDetailPage'));
const AdminTrackingPage = lazy(() => import('./pages/AdminTrackingPage'));
const DisputesPage = lazy(() => import('./pages/DisputesPage'));
const RewardsAdminPage = lazy(() => import('./pages/RewardsAdminPage'));
const BillingAdminPage = lazy(() => import('./pages/BillingAdminPage'));
const AiPerformancePage = lazy(() => import('./pages/AiPerformancePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const SystemHealthPage = lazy(() => import('./pages/SystemHealthPage'));
const AdminAccountPage = lazy(() => import('./pages/AdminAccountPage'));
const NotificationsPage = lazy(() => import('@/features/notifications/pages/NotificationsPage'));
const AssistantPage = lazy(() => import('@/features/assistant/pages/AssistantPage'));

/**
 * Admin area (/admin/*). Paths match the links the backend puts in
 * notifications and assistant cards (/admin/verifications, /admin/disputes,
 * /admin/analytics, /admin/pickups, /admin/ai, /admin/donations/:id, …).
 */
export default function AdminRoutes() {
  return (
    <RequireRole roles={['ADMIN']}>
      <Routes>
        <Route index element={<AdminOverviewPage />} />
        <Route path="analytics" element={<Navigate to="/admin" replace />} />
        <Route path="verifications" element={<VerificationsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="donations" element={<AdminDonationsPage />} />
        <Route path="donations/:id" element={<AdminDonationDetailPage />} />
        <Route path="requests" element={<Navigate to="/admin/donations" replace />} />
        <Route path="assistance" element={<AdminAssistancePage />} />
        <Route path="assistance/:id" element={<AdminAssistanceDetailPage />} />
        <Route path="pickups" element={<AdminPickupsPage />} />
        <Route path="pickups/tracking/:sessionId" element={<AdminTrackingPage />} />
        <Route path="pickups/:id" element={<AdminPickupDetailPage />} />
        <Route path="disputes" element={<DisputesPage />} />
        <Route path="rewards" element={<RewardsAdminPage />} />
        <Route path="billing" element={<BillingAdminPage />} />
        <Route path="ai" element={<AiPerformancePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="system" element={<SystemHealthPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="account" element={<AdminAccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </RequireRole>
  );
}
