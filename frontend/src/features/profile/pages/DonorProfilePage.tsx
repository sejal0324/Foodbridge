import { BadgeCheck } from 'lucide-react';
import { Banner, Card, CardBody, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui';
import { formatDateTime } from '@/utils/format';
import { useDonorProfile } from '../api';
import { AvailabilityCard } from '../components/AvailabilityCard';
import { AvailabilitySettingsCard } from '../components/AvailabilitySettingsCard';
import { BusinessDetailsCard } from '../components/BusinessDetailsCard';
import { CategoriesCard } from '../components/CategoriesCard';
import { ChangePasswordCard } from '../components/ChangePasswordCard';
import { DocumentsCard } from '../components/DocumentsCard';

export default function DonorProfilePage() {
  const query = useDonorProfile();
  if (query.isPending) return <LoadingState label="Loading profile…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const p = query.data;
  return (
    <>
      <PageHeader title="Profile & settings" description="Your business details, hours, documents and account security." meta={<StatusBadge status={p.verificationStatus} label={`Verification: ${p.verificationStatus.toLowerCase()}`} />} />
      <div className="space-y-6">
        <Card>
          <CardBody className="flex flex-wrap items-start gap-3">
            <BadgeCheck className="size-5 text-brand-300" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-white">
                {p.verificationStatus === 'APPROVED' ? `Verified${p.verifiedAt ? ` on ${formatDateTime(p.verifiedAt)}` : ''}` : `Verification status: ${p.verificationStatus.toLowerCase()}`}
              </p>
              {p.verificationNotes ? <p className="mt-0.5 text-slate-400">Notes from FoodBridge: {p.verificationNotes}</p> : null}
              {p.verificationStatus === 'PENDING' ? <p className="mt-0.5 text-slate-400">Complete your details and upload documents below; FoodBridge reviews them before approval.</p> : null}
            </div>
          </CardBody>
        </Card>
        {p.verificationStatus === 'REJECTED' ? <Banner tone="danger">Your verification was not approved. Update the details and documents below, then contact FoodBridge for a new review.</Banner> : null}
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <BusinessDetailsCard key={p.id + p.businessName} profile={p} />
            <DocumentsCard organisationType="DONOR" />
          </div>
          <div className="space-y-6">
            <AvailabilitySettingsCard profile={p} />
            <AvailabilityCard availability={p.availability} />
            <CategoriesCard selected={p.categories.map((c) => c.id)} />
            <ChangePasswordCard />
          </div>
        </div>
      </div>
    </>
  );
}
