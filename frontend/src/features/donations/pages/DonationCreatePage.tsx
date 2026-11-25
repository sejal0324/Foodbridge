import { useNavigate } from 'react-router';
import { ErrorState, LoadingState, PageHeader, useToast } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { useDonorProfile } from '@/features/profile/api';
import { ApprovalGate } from '@/features/profile/components/VerificationBanner';
import { formatQuantity } from '@/utils/format';
import { useCreateDonation, useFoodCategories } from '../api';
import { DonationForm } from '../components/DonationForm';

export default function DonationCreatePage() {
  const user = useCurrentUser();
  const categories = useFoodCategories();
  const profile = useDonorProfile();
  const create = useCreateDonation();
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="New donation" description="List surplus food. Matched NGOs nearby are notified as soon as you publish." back={{ to: '/donor/donations', label: 'Donations' }} />
      <ApprovalGate user={user} feature="Listing food">
        {categories.isPending || profile.isPending ? (
          <LoadingState />
        ) : categories.isError ? (
          <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
        ) : (
          <div className="max-w-4xl">
            <DonationForm
              categories={categories.data}
              profileLocation={profile.data?.location ?? null}
              profileAddress={profile.data ? [profile.data.addressLine, profile.data.city].filter(Boolean).join(', ') || null : null}
              submit={async (input) => {
                const created = await create.mutateAsync(input);
                toast.success(
                  created.status === 'DRAFT' ? 'Draft saved' : 'Donation published',
                  created.status === 'DRAFT' ? 'Publish it when the food is ready.' : `${formatQuantity(created.quantity, created.unit)} listed. Matched NGOs are being notified.`,
                );
                for (const w of created.warnings) toast.warning('Please review', w);
                navigate(`/donor/donations/${created.id}`, { replace: true });
              }}
            />
          </div>
        )}
      </ApprovalGate>
    </>
  );
}
