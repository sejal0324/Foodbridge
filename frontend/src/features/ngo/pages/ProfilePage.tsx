import { BadgeCheck, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { Banner, Card, CardBody, CardHeader, DescriptionList, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { NotificationPreferencesCard } from '@/features/notifications';
import { ChangePasswordCard, DocumentsCard } from '@/features/profile';
import { formatDateTime } from '@/utils/format';
import { isNgoOwner, ngoNameOf } from '../access';
import { useNgoProfile } from '../api';
import { FoodPreferencesCard, NgoDetailsCard } from '../components/ProfileCards';

export default function ProfilePage() {
  const user = useCurrentUser();
  return isNgoOwner(user) ? <OwnerProfile /> : <RepresentativeAccount />;
}

function OwnerProfile() {
  const query = useNgoProfile();
  const location = useLocation();
  // Links such as /ngo/profile#food-preferences scroll to the card once it is rendered.
  useEffect(() => {
    if (!query.isSuccess || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [query.isSuccess, location.hash]);

  if (query.isPending) return <LoadingState label="Loading profile…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const p = query.data;
  return (
    <>
      <PageHeader
        title="Profile & settings"
        description="Your organisation, what you accept, verification documents and account security."
        meta={<StatusBadge status={p.verificationStatus} label={`Verification: ${p.verificationStatus.toLowerCase()}`} />}
      />
      <div className="space-y-6">
        <Card>
          <CardBody className="flex flex-wrap items-start gap-3">
            <BadgeCheck className="size-5 text-brand-300" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-white">
                {p.verificationStatus === 'APPROVED' ? `Verified${p.verifiedAt ? ` on ${formatDateTime(p.verifiedAt)}` : ''}` : `Verification status: ${p.verificationStatus.toLowerCase()}`}
              </p>
              {p.verificationNotes ? <p className="mt-0.5 text-slate-400">Notes from FoodBridge: {p.verificationNotes}</p> : null}
              {p.verificationStatus === 'PENDING' ? <p className="mt-0.5 text-slate-400">Complete your details and upload your registration documents below; FoodBridge reviews them before approval.</p> : null}
            </div>
          </CardBody>
        </Card>
        {p.verificationStatus === 'REJECTED' ? <Banner tone="danger">Your verification was not approved. Update the details and documents below, then contact FoodBridge for a new review.</Banner> : null}
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <NgoDetailsCard key={`${p.id}-${p.organizationName}`} profile={p} />
          </div>
          <div className="space-y-6">
            <FoodPreferencesCard key={p.foodPreferences.map((c) => c.id).join(',')} selected={p.foodPreferences.map((c) => c.id)} />
            <DocumentsCard organisationType="NGO" />
            <ChangePasswordCard />
            <NotificationPreferencesCard />
          </div>
        </div>
      </div>
    </>
  );
}

/** Representative-only accounts: who they collect for, password and notification settings. */
function RepresentativeAccount() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader title="Account" description={`Your FoodBridge login as a representative of ${ngoNameOf(user)}.`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your details" icon={<UserRound className="size-4" aria-hidden="true" />} />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { term: 'Name', description: user.fullName },
                  { term: 'Email', description: user.email },
                  { term: 'Phone', description: user.phone ?? 'Not set' },
                  { term: 'Collects for', description: ngoNameOf(user) },
                  { term: 'Representative status', description: <StatusBadge status={user.representative?.status} /> },
                ]}
              />
              <p className="mt-4 text-xs text-slate-400">Your photo, phone number and ID details are managed by {ngoNameOf(user)}. Ask them to update anything that is wrong.</p>
            </CardBody>
          </Card>
          <ChangePasswordCard />
        </div>
        <NotificationPreferencesCard />
      </div>
    </>
  );
}
