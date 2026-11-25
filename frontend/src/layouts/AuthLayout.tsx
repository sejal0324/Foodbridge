import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { Logo } from './Logo';

/** Centered card layout for sign-in, registration and password pages. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <Logo />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <Outlet />
      </main>
      <footer className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-slate-500">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Your session is kept in a secure, http-only cookie. Never share your password.
      </footer>
    </div>
  );
}

export function AuthCard({ title, description, children, wide }: { title: string; description?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'w-full max-w-3xl' : 'w-full max-w-md'}>
      <div className="rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl shadow-black/40 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-slate-400">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
