import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { ApprovalGate } from '@/features/profile/components/VerificationBanner';
import { VerificationFlow } from '../components/VerificationFlow';

/** Start verification by scanning a pass; the pass identifies the pickup. */
export default function PickupVerifyPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Verify a pickup" description="Scan the representative’s pass to start the handover checks." back={{ to: '/donor/pickups', label: 'Pickups' }} />
      <ApprovalGate user={user} feature="Pickup verification">
        <div className="max-w-3xl">
          <VerificationFlow onPickupIdentified={(id) => navigate(`/donor/pickups/${id}`, { replace: true })} />
        </div>
      </ApprovalGate>
    </>
  );
}
