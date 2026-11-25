import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Banner, Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { ChangePasswordCard } from '@/features/profile/components/ChangePasswordCard';
import { formatDateTime, humanize } from '@/utils/format';

export default function AdminAccountPage() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader title="Account" description="Your administrator account and password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Administrator" icon={<ShieldCheck className="size-4" aria-hidden="true" />} />
          <CardBody className="space-y-4">
            <DescriptionList
              columns={1}
              items={[
                { term: 'Name', description: user.fullName },
                { term: 'Email', description: user.email },
                { term: 'Role', description: 'Admin' },
                { term: 'Admin level', description: user.adminLevel ? humanize(user.adminLevel) : '—' },
                { term: 'Account status', description: humanize(user.accountStatus) },
                ...(user.createdAt ? [{ term: 'Created', description: formatDateTime(user.createdAt) }] : []),
              ]}
            />
            <Banner tone="info">
              Admin accounts are created only on the server, never through registration. Your actions are recorded in the{' '}
              <Link to={`/admin/audit?actorUserId=${user.id}`} className="underline">
                audit log
              </Link>
              . Notification settings are on the{' '}
              <Link to="/admin/notifications" className="underline">
                Notifications
              </Link>{' '}
              page.
            </Banner>
          </CardBody>
        </Card>
        <ChangePasswordCard />
      </div>
    </>
  );
}
