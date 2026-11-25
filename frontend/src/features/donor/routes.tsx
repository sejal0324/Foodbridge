import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import { RequireRole } from '@/app/guards';
import { NotFoundPage } from '@/components/feedback';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const ForecastPage = lazy(() => import('./pages/ForecastPage'));
const DonationListPage = lazy(() => import('@/features/donations/pages/DonationListPage'));
const DonationCreatePage = lazy(() => import('@/features/donations/pages/DonationCreatePage'));
const DonationDetailPage = lazy(() => import('@/features/donations/pages/DonationDetailPage'));
const DonorAssistancePage = lazy(() => import('@/features/assistance/pages/DonorAssistancePage'));
const AssistanceDetailPage = lazy(() => import('@/features/assistance/pages/AssistanceDetailPage'));
const PickupListPage = lazy(() => import('@/features/pickups/pages/PickupListPage'));
const PickupVerifyPage = lazy(() => import('@/features/pickups/pages/PickupVerifyPage'));
const PickupDetailPage = lazy(() => import('@/features/pickups/pages/PickupDetailPage'));
const RewardsPage = lazy(() => import('@/features/rewards/pages/RewardsPage'));
const DonorAnalyticsPage = lazy(() => import('@/features/analytics/pages/DonorAnalyticsPage'));
const NotificationsPage = lazy(() => import('@/features/notifications/pages/NotificationsPage'));
const AssistantPage = lazy(() => import('@/features/assistant/pages/AssistantPage'));
const DonorProfilePage = lazy(() => import('@/features/profile/pages/DonorProfilePage'));

/**
 * Donor area (/donor/*). Paths here must match the links the backend puts in
 * notifications (e.g. /donor/donations/:id, /donor/assistance/:id, /donor/pickups/:id).
 */
export default function DonorRoutes() {
  return (
    <RequireRole roles={['DONOR']}>
      <Routes>
        <Route index element={<OverviewPage />} />
        <Route path="donations" element={<DonationListPage />} />
        <Route path="donations/new" element={<DonationCreatePage />} />
        <Route path="donations/:id" element={<DonationDetailPage />} />
        <Route path="assistance" element={<DonorAssistancePage />} />
        <Route path="assistance/:id" element={<AssistanceDetailPage />} />
        <Route path="pickups" element={<PickupListPage />} />
        <Route path="pickups/verify" element={<PickupVerifyPage />} />
        <Route path="pickups/:id" element={<PickupDetailPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="forecast" element={<ForecastPage />} />
        <Route path="analytics" element={<DonorAnalyticsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="profile" element={<DonorProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </RequireRole>
  );
}
