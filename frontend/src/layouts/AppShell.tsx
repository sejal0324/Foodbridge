import { ChevronDown, Database, Lock, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Avatar, Badge, Button, LoadingState, Popover } from '@/components/ui';
import { useRoleAnalytics } from '@/features/analytics/api';
import { isOrganisationApproved, useCurrentUser, useAuth } from '@/features/auth/auth-context';
import { NotificationBell, useRealtime } from '@/features/notifications';
import { VerificationBanner } from '@/features/profile/components/VerificationBanner';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { DataLabel, Me } from '@/types';
import { cn } from '@/utils/cn';
import { Logo } from './Logo';
import { NAVIGATION, ROLE_LABEL, rolePath, visibleNavSections, type NavSection } from './navigation';

const COLLAPSE_KEY = 'fb.sidebarCollapsed';

/**
 * Authenticated application frame: role-aware sidebar (collapsible on
 * desktop, a drawer on mobile), top bar with the notification bell, the
 * "Demo data" pill and the user menu, and the verification banner.
 */
export function AppShell() {
  const user = useCurrentUser();
  useRealtime();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const location = useLocation();
  // The drawer belongs to the page it was opened on, so navigating closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === location.pathname;
  const setDrawerOpen = (open: boolean) => setDrawerPath(open ? location.pathname : null);
  // Entries can be limited to some users of a role (e.g. NGO representatives see only their own work).
  const sections = visibleNavSections(NAVIGATION[user.role], user);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-md bg-brand-600 px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      {isDesktop ? (
        <aside className={cn('sticky top-0 flex h-dvh shrink-0 flex-col border-r border-white/10 bg-surface/60 transition-[width]', collapsed ? 'w-[72px]' : 'w-64')}>
          <div className={cn('flex h-16 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
            <Logo to={rolePath(user.role)} compact={collapsed} />
            {!collapsed ? (
              <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <SidebarNav sections={sections} user={user} collapsed={collapsed} />
          {collapsed ? (
            <div className="border-t border-white/10 p-2">
              <Button variant="ghost" size="icon" onClick={() => setCollapsed(false)} aria-label="Expand sidebar" className="w-full">
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </aside>
      ) : null}

      {!isDesktop && drawerOpen ? <MobileDrawer sections={sections} user={user} onClose={() => setDrawerOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} onOpenMenu={() => setDrawerOpen(true)} showMenuButton={!isDesktop} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8">
          {user.organization && user.organization.verificationStatus !== 'APPROVED' ? (
            <div className="mb-6">
              <VerificationBanner user={user} />
            </div>
          ) : null}
          <Suspense fallback={<LoadingState label="Loading page…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function SidebarNav({ sections, user, collapsed, onNavigate }: { sections: NavSection[]; user: Me; collapsed: boolean; onNavigate?: () => void }) {
  const approved = isOrganisationApproved(user);
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i} className={cn(i > 0 && 'mt-6')}>
          {section.title && !collapsed ? <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{section.title}</p> : null}
          {section.title && collapsed && i > 0 ? <div className="mx-3 mb-3 border-t border-white/10" aria-hidden="true" /> : null}
          <ul className="flex flex-col gap-1">
            {section.items.map((item) => {
              const locked = item.requiresApproval && !approved;
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-400',
                        collapsed && 'justify-center px-0',
                        isActive ? 'bg-brand-600/15 text-white ring-1 ring-brand-400/20 ring-inset' : 'text-slate-400 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('size-[18px] shrink-0', isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')} aria-hidden="true" />
                        <span className={cn(collapsed && 'sr-only', 'flex-1 truncate')}>{item.label}</span>
                        {locked && !collapsed ? <Lock className="size-3.5 text-slate-500" aria-label="Requires verification" /> : null}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function MobileDrawer({ sections, user, onClose }: { sections: NavSection[]; user: Me; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = original;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <div className="absolute inset-0 animate-fade-in bg-black/60" aria-hidden="true" onClick={onClose} />
      <div className="relative flex h-full w-72 max-w-[85vw] animate-slide-up flex-col border-r border-white/10 bg-surface">
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <Logo to={rolePath(user.role)} />
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close navigation" data-autofocus autoFocus>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <SidebarNav sections={sections} user={user} collapsed={false} onNavigate={onClose} />
      </div>
    </div>
  );
}

function DemoDataPill({ user }: { user: Me }) {
  const analytics = useRoleAnalytics<{ dataLabel: DataLabel }>(user.role);
  const label = analytics.data?.dataLabel;
  if (!label || label === 'REAL') return null;
  return (
    <Badge tone="violet" icon={<Database className="size-3" aria-hidden="true" />} title="Statistics include demo or synthetic records, not only real activity.">
      Demo data
    </Badge>
  );
}

function Topbar({ user, onOpenMenu, showMenuButton }: { user: Me; onOpenMenu: () => void; showMenuButton: boolean }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-canvas/85 px-4 backdrop-blur sm:px-6 lg:px-8">
      {showMenuButton ? (
        <>
          <Button variant="ghost" size="icon" onClick={onOpenMenu} aria-label="Open navigation">
            <Menu className="size-5" aria-hidden="true" />
          </Button>
          <Logo to={rolePath(user.role)} compact />
        </>
      ) : null}
      <div className="min-w-0 flex-1">
        {user.organization ? <p className="hidden truncate text-sm text-slate-400 sm:block">{user.organization.name}</p> : null}
        {!user.organization && user.representative ? <p className="hidden truncate text-sm text-slate-400 sm:block">Representative · {user.representative.ngoName}</p> : null}
      </div>
      <DemoDataPill user={user} />
      <NotificationBell allHref={rolePath(user.role, 'notifications')} />
      <UserMenu user={user} />
    </header>
  );
}

function UserMenu({ user }: { user: Me }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Popover
      label="Account"
      className="w-64"
      trigger={(props) => (
        <button type="button" {...props} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-brand-400" aria-label={`Account menu for ${user.fullName}`}>
          <Avatar name={user.fullName} size="sm" />
          <ChevronDown className="hidden size-4 text-slate-400 sm:block" aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="py-2">
          <div className="border-b border-white/10 px-4 pb-3">
            <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
            <Badge tone="brand" className="mt-2">
              {ROLE_LABEL[user.role]}
            </Badge>
          </div>
          <div className="p-1">
            <button
              type="button"
              onClick={() => {
                close();
                navigate(rolePath(user.role, 'profile'));
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
            >
              <Settings className="size-4 text-slate-400" aria-hidden="true" /> Profile & settings
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await logout();
                close();
                navigate('/login', { replace: true });
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              <LogOut className="size-4 text-slate-400" aria-hidden="true" /> {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
