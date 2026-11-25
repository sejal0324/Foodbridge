import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Banner, Button, ButtonLink } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-context';
import { rolePath } from '@/layouts/navigation';
import type { Me } from '@/types';

const COPY = {
  PENDING: {
    tone: 'warning' as const,
    title: 'Verification pending',
    body: 'FoodBridge is reviewing your organisation. Until it is approved you can complete your profile and upload verification documents; listing food, offers, pickups and forecasts are unavailable.',
  },
  REJECTED: {
    tone: 'danger' as const,
    title: 'Verification was not approved',
    body: 'Review the notes on your profile, update your details and upload the requested documents. Contact FoodBridge support if you think this is a mistake.',
  },
  SUSPENDED: {
    tone: 'danger' as const,
    title: 'Organisation suspended',
    body: 'Your organisation is suspended, so food listings and collections are disabled. Contact FoodBridge support.',
  },
};

/** Shown at the top of the app while the user's organisation is not APPROVED. */
export function VerificationBanner({ user }: { user: Me }) {
  const { reloadUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const status = user.organization?.verificationStatus;
  if (!user.organization || !status || status === 'APPROVED') return null;
  const copy = COPY[status];
  return (
    <Banner
      tone={copy.tone}
      title={copy.title}
      icon={<ShieldAlert className="size-5" aria-hidden="true" />}
      actions={
        <>
          <ButtonLink to={rolePath(user.role, 'profile')} size="sm" variant="secondary">
            Profile & documents
          </ButtonLink>
          <Button
            size="sm"
            variant="ghost"
            loading={checking}
            onClick={async () => {
              setChecking(true);
              await reloadUser();
              setChecking(false);
            }}
          >
            Check status again
          </Button>
        </>
      }
    >
      {copy.body}
    </Banner>
  );
}

/**
 * Wraps a feature that needs an APPROVED organisation. Otherwise it explains
 * why the feature is unavailable and links to the profile instead of showing
 * actions that would fail.
 */
export function ApprovalGate({ user, children, feature }: { user: Me; children: ReactNode; feature: string }) {
  const status = user.organization?.verificationStatus;
  if (user.role === 'ADMIN' || !user.organization || status === 'APPROVED') return <>{children}</>;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-surface px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-amber-400/10 text-amber-300">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </div>
      <div className="max-w-md">
        <p className="text-base font-semibold text-white">{feature} is available after verification</p>
        <p className="mt-1 text-sm text-slate-400">
          {status === 'PENDING'
            ? 'Your organisation is waiting for FoodBridge verification. Make sure your profile is complete and your documents are uploaded.'
            : status === 'REJECTED'
              ? 'Your verification was not approved. Update your details and documents, then ask FoodBridge to review again.'
              : 'Your organisation is suspended. Contact FoodBridge support.'}
        </p>
      </div>
      <ButtonLink to={rolePath(user.role, 'profile')} variant="primary">
        Go to profile & documents
      </ButtonLink>
    </div>
  );
}
