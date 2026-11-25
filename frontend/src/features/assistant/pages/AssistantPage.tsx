import { PageHeader } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { AssistantPanel } from '../components/AssistantPanel';

/** Shared assistant page: mount it at /<role>/assistant. */
export default function AssistantPage() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader title="AI assistant" description="Ask about your donations, requests, pickups, forecasts and rewards. Answers come only from your own data." />
      <AssistantPanel role={user.role} />
    </>
  );
}
