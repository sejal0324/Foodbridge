import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import { RequireRole } from '@/app/guards';
import { NotFoundPage } from '@/components/feedback';
import { NgoApproved, RequireNgoOwner } from './guards';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage'));
const MarketplaceDetailPage = lazy(() => import('./pages/MarketplaceDetailPage'));
const RequestsPage = lazy(() => import('./pages/RequestsPage'));
const AssistanceListPage = lazy(() => import('./pages/AssistanceListPage'));
const AssistanceCreatePage = lazy(() => import('./pages/AssistanceCreatePage'));
const AssistanceDetailPage = lazy(() => import('./pages/AssistanceDetailPage'));
const CollectionsPage = lazy(() => import('./pages/CollectionsPage'));
const PickupListPage = lazy(() => import('./pages/PickupListPage'));
const PickupDetailPage = lazy(() => import('./pages/PickupDetailPage'));
const RepresentativesPage = lazy(() => import('./pages/RepresentativesPage'));
const PlanningPage = lazy(() => import('./pages/PlanningPage'));
const PlanDetailPage = lazy(() => import('./pages/PlanDetailPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationsPage = lazy(() => import('@/features/notifications/pages/NotificationsPage'));
const AssistantPage = lazy(() => import('@/features/assistant/pages/AssistantPage'));

/**
 * NGO area (/ngo/*). Paths match the links the backend puts in notifications:
 * /ngo/assistance/:id, /ngo/pickups/:id, /ngo/marketplace/:id, /ngo/requests,
 * /ngo/collections, /ngo/billing, /ngo/profile, /ngo/analytics, /ngo/planning.
 *
 * Owner-only pages sit under <RequireNgoOwner>; representative-only accounts
 * can open the overview, their pickups, notifications, the assistant and their account.
 */
export default function NgoRoutes() {
  return (
    <RequireRole roles={['NGO']}>
      <Routes>
        <Route index element={<OverviewPage />} />
        <Route path="pickups" element={<PickupListPage />} />
        <Route path="pickups/:id" element={<PickupDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route element={<RequireNgoOwner />}>
          <Route path="marketplace" element={<NgoApproved feature="The donation marketplace"><MarketplacePage /></NgoApproved>} />
          <Route path="marketplace/:id" element={<NgoApproved feature="Requesting food"><MarketplaceDetailPage /></NgoApproved>} />
          <Route path="requests" element={<NgoApproved feature="Donation requests"><RequestsPage /></NgoApproved>} />
          <Route path="assistance" element={<NgoApproved feature="Assistance requests"><AssistanceListPage /></NgoApproved>} />
          <Route path="assistance/new" element={<NgoApproved feature="Asking donors for food"><AssistanceCreatePage /></NgoApproved>} />
          <Route path="assistance/:id" element={<NgoApproved feature="Assistance requests"><AssistanceDetailPage /></NgoApproved>} />
          <Route path="collections" element={<NgoApproved feature="Collections"><CollectionsPage /></NgoApproved>} />
          <Route path="representatives" element={<NgoApproved feature="Managing representatives"><RepresentativesPage /></NgoApproved>} />
          <Route path="planning" element={<NgoApproved feature="Route planning"><PlanningPage /></NgoApproved>} />
          <Route path="planning/:id" element={<NgoApproved feature="Route planning"><PlanDetailPage /></NgoApproved>} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </RequireRole>
  );
}
