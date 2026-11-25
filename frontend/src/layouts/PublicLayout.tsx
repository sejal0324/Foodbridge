import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { Button, ButtonLink } from '@/components/ui';
import { homePathFor, useAuth } from '@/features/auth/auth-context';
import { Logo } from './Logo';

const NAV = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#ai', label: 'AI capabilities' },
  { href: '#donors', label: 'For donors' },
  { href: '#ngos', label: 'For NGOs' },
  { href: '#impact', label: 'Impact' },
];

/** Marketing pages: top navigation and footer. */
export function PublicLayout() {
  const { status, user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-md bg-brand-600 px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {status === 'authenticated' && user ? (
              <ButtonLink to={homePathFor(user)} size="sm">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/register" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'}>
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </Button>
        </div>
        {open ? (
          <div id="mobile-nav" className="border-t border-white/10 px-4 py-3 md:hidden">
            <nav aria-label="Primary mobile" className="flex flex-col">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/5">
                  {n.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex gap-2">
              {status === 'authenticated' && user ? (
                <ButtonLink to={homePathFor(user)} size="sm" className="flex-1">
                  Open dashboard
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink to="/login" variant="outline" size="sm" className="flex-1">
                    Sign in
                  </ButtonLink>
                  <ButtonLink to="/register" size="sm" className="flex-1">
                    Get started
                  </ButtonLink>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-surface/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-slate-400">Predict. Match. Redistribute. FoodBridge AI connects food businesses across India with verified NGOs so surplus food reaches people instead of bins.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Platform</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li>
              <a href="#how-it-works" className="hover:text-white">
                How it works
              </a>
            </li>
            <li>
              <a href="#ai" className="hover:text-white">
                AI capabilities
              </a>
            </li>
            <li>
              <a href="#impact" className="hover:text-white">
                Impact
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Get started</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li>
              <Link to="/register?type=DONOR" className="hover:text-white">
                Register as a donor
              </Link>
            </li>
            <li>
              <Link to="/register?type=NGO" className="hover:text-white">
                Register an NGO
              </Link>
            </li>
            <li>
              <Link to="/login" className="hover:text-white">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-slate-500 sm:px-6 lg:px-8">
          © {new Date().getFullYear()} FoodBridge AI. Donors remain responsible for the food they donate; FoodBridge does not certify food safety.
        </p>
      </div>
    </footer>
  );
}
