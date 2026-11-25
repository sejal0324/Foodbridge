import { ShieldAlert } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Banner, PageHeader } from '@/components/ui';
import { TrackingViewer, useTrackingSessionQuery } from '@/features/tracking';

/** Admin view of one LiveTrack session (GET /tracking/:id is audited for admins). */
export default function AdminTrackingPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  // Shares the cache entry the viewer uses, so this does not add a request.
  const session = useTrackingSessionQuery(sessionId, false);
  const s = session.data;
  return (
    <>
      <PageHeader
        title="Live tracking"
        description={s ? `${s.representativeName} · ${s.stage === 'TO_PICKUP' ? 'travelling to the pickup point' : 'travelling to the destination'}` : 'Representative location'}
        back={{ to: '/admin/pickups?tab=tracking', label: 'Active tracking sessions' }}
        actions={
          s ? (
            <Link to={`/admin/pickups/${s.pickupId}`} className="text-sm text-brand-300 hover:underline">
              Open the pickup
            </Link>
          ) : null
        }
      />
      <div className="space-y-6">
        <Banner tone="warning" icon={<ShieldAlert className="size-5 text-amber-300" aria-hidden="true" />} title="Viewing live locations is recorded in the audit log.">
          Representatives share their location only for an active pickup and with consent. Use this view for operational or safety reasons only.
        </Banner>
        {sessionId ? <TrackingViewer sessionId={sessionId} destinationLabel={s?.stage === 'TO_DESTINATION' ? 'Destination' : 'Pickup point'} /> : null}
      </div>
    </>
  );
}
