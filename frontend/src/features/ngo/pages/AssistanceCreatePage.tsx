import { useNavigate } from 'react-router';
import { ErrorState, LoadingState, PageHeader, useToast } from '@/components/ui';
import { useCreateAssistanceRequest, useNgoProfile } from '../api';
import { AssistanceForm } from '../components/AssistanceForm';
import { defaultAssistanceValues } from '../schemas';

export default function AssistanceCreatePage() {
  const profile = useNgoProfile();
  const create = useCreateAssistanceRequest();
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <>
      <PageHeader title="Ask donors for food" description="Describe what you need and when. Donors nearby who can help are notified and can offer all or part of it." back={{ to: '/ngo/assistance', label: 'Assistance requests' }} />
      {profile.isPending ? (
        <LoadingState label="Loading your profile…" />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <AssistanceForm
          ngoLocation={profile.data.location}
          defaultValues={defaultAssistanceValues({
            location: profile.data.location,
            address: [profile.data.addressLine, profile.data.city].filter(Boolean).join(', '),
            beneficiaries: profile.data.beneficiariesCount,
          })}
          onSubmit={async (input) => {
            const created = await create.mutateAsync(input);
            toast.success('Request published', 'Matching donors are being notified.');
            navigate(`/ngo/assistance/${created.id}`);
          }}
        />
      )}
    </>
  );
}
