import {
  Award,
  BarChart3,
  Bell,
  Bot,
  Building2,
  HandHeart,
  LayoutDashboard,
  TrendingUp,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types';
// NGO area (aliased so they never clash with other areas' icon imports).
import {
  ClipboardList as NgoRequestsIcon,
  IndianRupee as NgoBillingIcon,
  PackageCheck as NgoCollectionsIcon,
  Route as NgoPlanningIcon,
  Store as NgoMarketplaceIcon,
  UserCog as NgoAccountIcon,
  Users as NgoRepresentativesIcon,
} from 'lucide-react';
import { isNgoOwner, isRepresentativeOnly } from '@/features/ngo/access';
import type { Me } from '@/types';

/**
 * Sidebar navigation per role. The NGO and admin areas add their entries to
 * their own arrays below (paths must live under /ngo/* and /admin/*).
 *
 * - `end`: exact match for the active state (use for the area's index route).
 * - `requiresApproval`: shown but marked as locked while the organisation is not APPROVED.
 */
export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  requiresApproval?: boolean;
  /** Optional: show the entry only to some users of the role (e.g. NGO owners vs representatives). */
  visible?: (user: Me) => boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const DONOR_NAV: NavSection[] = [
  {
    items: [
      { label: 'Overview', to: '/donor', icon: LayoutDashboard, end: true },
      { label: 'Donations', to: '/donor/donations', icon: UtensilsCrossed },
      { label: 'NGO requests', to: '/donor/assistance', icon: HandHeart, requiresApproval: true },
      { label: 'Pickups', to: '/donor/pickups', icon: Truck },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Rewards', to: '/donor/rewards', icon: Award },
      { label: 'Forecast & records', to: '/donor/forecast', icon: TrendingUp },
      { label: 'Analytics', to: '/donor/analytics', icon: BarChart3 },
      { label: 'AI assistant', to: '/donor/assistant', icon: Bot },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', to: '/donor/notifications', icon: Bell },
      { label: 'Profile & settings', to: '/donor/profile', icon: Building2 },
    ],
  },
];

/**
 * NGO area. Owners (organisation accounts) see everything; representative-only
 * accounts see their pickups, notifications, the assistant and their account.
 */
const ngoOwner = (user: Me) => isNgoOwner(user);
const ngoRepresentativeOnly = (user: Me) => isRepresentativeOnly(user);
export const NGO_NAV: NavSection[] = [
  {
    items: [
      { label: 'Overview', to: '/ngo', icon: LayoutDashboard, end: true },
      { label: 'Marketplace', to: '/ngo/marketplace', icon: NgoMarketplaceIcon, requiresApproval: true, visible: ngoOwner },
      { label: 'My requests', to: '/ngo/requests', icon: NgoRequestsIcon, requiresApproval: true, visible: ngoOwner },
      { label: 'Assistance requests', to: '/ngo/assistance', icon: HandHeart, requiresApproval: true, visible: ngoOwner },
    ],
  },
  {
    title: 'Collections',
    items: [
      { label: 'Collections', to: '/ngo/collections', icon: NgoCollectionsIcon, requiresApproval: true, visible: ngoOwner },
      { label: 'Pickups', to: '/ngo/pickups', icon: Truck, visible: ngoOwner },
      { label: 'My pickups', to: '/ngo/pickups', icon: Truck, visible: ngoRepresentativeOnly },
      { label: 'Representatives', to: '/ngo/representatives', icon: NgoRepresentativesIcon, requiresApproval: true, visible: ngoOwner },
      { label: 'Route planning', to: '/ngo/planning', icon: NgoPlanningIcon, requiresApproval: true, visible: ngoOwner },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Billing', to: '/ngo/billing', icon: NgoBillingIcon, visible: ngoOwner },
      { label: 'Analytics', to: '/ngo/analytics', icon: BarChart3, visible: ngoOwner },
      { label: 'AI assistant', to: '/ngo/assistant', icon: Bot },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', to: '/ngo/notifications', icon: Bell },
      { label: 'Profile & settings', to: '/ngo/profile', icon: Building2, visible: ngoOwner },
      { label: 'Account', to: '/ngo/profile', icon: NgoAccountIcon, visible: ngoRepresentativeOnly },
    ],
  },
];

/** Sections with the entries this user may see (sections left empty are dropped). */
export function visibleNavSections(sections: NavSection[], user: Me): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.visible || item.visible(user)) }))
    .filter((section) => section.items.length > 0);
}

// Admin area icons (aliased so they never clash with other areas' icon imports).
import {
  Activity as AdminSystemIcon,
  BrainCircuit as AdminAiIcon,
  Receipt as AdminBillingIcon,
  Scale as AdminDisputesIcon,
  ScrollText as AdminAuditIcon,
  ShieldCheck as AdminVerificationsIcon,
  SlidersHorizontal as AdminSettingsIcon,
  UserCog as AdminAccountIcon,
  Users as AdminUsersIcon,
} from 'lucide-react';

/** Admin area (/admin/*, role ADMIN). */
export const ADMIN_NAV: NavSection[] = [
  { items: [{ label: 'Overview', to: '/admin', icon: LayoutDashboard, end: true }] },
  {
    title: 'Operations',
    items: [
      { label: 'Verifications', to: '/admin/verifications', icon: AdminVerificationsIcon },
      { label: 'Users', to: '/admin/users', icon: AdminUsersIcon },
      { label: 'Donations', to: '/admin/donations', icon: UtensilsCrossed },
      { label: 'Assistance requests', to: '/admin/assistance', icon: HandHeart },
      { label: 'Pickups & verification', to: '/admin/pickups', icon: Truck },
      { label: 'Disputes', to: '/admin/disputes', icon: AdminDisputesIcon },
    ],
  },
  {
    title: 'Rewards & billing',
    items: [
      { label: 'Rewards', to: '/admin/rewards', icon: Award },
      { label: 'Billing', to: '/admin/billing', icon: AdminBillingIcon },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'AI performance', to: '/admin/ai', icon: AdminAiIcon },
      { label: 'Settings', to: '/admin/settings', icon: AdminSettingsIcon },
      { label: 'Audit log', to: '/admin/audit', icon: AdminAuditIcon },
      { label: 'System health', to: '/admin/system', icon: AdminSystemIcon },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', to: '/admin/notifications', icon: Bell },
      { label: 'AI assistant', to: '/admin/assistant', icon: Bot },
      { label: 'Account', to: '/admin/account', icon: AdminAccountIcon },
    ],
  },
];

export const NAVIGATION: Record<Role, NavSection[]> = {
  DONOR: DONOR_NAV,
  NGO: NGO_NAV,
  ADMIN: ADMIN_NAV,
};

/** Role-specific analytics endpoint; its `dataLabel` drives the "Demo data" pill in the top bar. */
export const ROLE_ANALYTICS_ENDPOINT: Record<Role, string> = {
  DONOR: '/analytics/donor',
  NGO: '/analytics/ngo',
  ADMIN: '/analytics/admin',
};

export const ROLE_LABEL: Record<Role, string> = { DONOR: 'Donor', NGO: 'NGO', ADMIN: 'Admin' };

/** `/donor` + `notifications` → `/donor/notifications`. */
export function rolePath(role: Role, sub = ''): string {
  const base = { DONOR: '/donor', NGO: '/ngo', ADMIN: '/admin' }[role];
  return sub ? `${base}/${sub.replace(/^\//, '')}` : base;
}
