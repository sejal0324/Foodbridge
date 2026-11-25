import { LocateFixed, MapPinOff, Navigation, Square } from 'lucide-react';
import { useState } from 'react';
import { Badge, Banner, Button, Card, CardBody, CardHeader, Dialog, Spinner } from '@/components/ui';
import type { PickupDetail } from '@/types';
import { formatMeters, formatTime } from '@/utils/format';
import { useLocationSharing } from '../tracking/useLocationSharing';
import type { TrackingStage } from '../types';

/** Consent text: what is shared, with whom and for how long. */
function ConsentDialog({ stage, donorName, ngoName, onAccept, onClose }: { stage: TrackingStage; donorName: string; ngoName: string; onAccept: () => void; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Share your location for this trip?"
      description="Sharing is optional. The donor verifies you with your pass and photo ID either way."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={onAccept} data-autofocus leftIcon={<LocateFixed className="size-4" aria-hidden="true" />}>
            I agree, start sharing
          </Button>
        </>
      }
    >
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-white">What is shared</dt>
          <dd className="text-slate-300">Your device’s GPS position, its accuracy, heading and speed, about every 10 seconds (or every 25 m) while this page is open.</dd>
        </div>
        <div>
          <dt className="font-medium text-white">Who can see it</dt>
          <dd className="text-slate-300">
            {stage === 'TO_PICKUP' ? `${donorName} (only for this trip to the pickup), ` : 'Not the donor, '}
            {ngoName}, and FoodBridge administrators (every admin view is recorded). It is never public.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-white">For how long</dt>
          <dd className="text-slate-300">
            Until you press Stop, the {stage === 'TO_PICKUP' ? 'handover' : 'delivery'} is confirmed, or the pickup is cancelled. The detailed route is deleted 30 days after the trip.
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-slate-400">Your browser will ask for location permission next. Only foreground sharing works in a browser tab: keep this page open and the screen on.</p>
    </Dialog>
  );
}

/**
 * LiveTrack controls for the assigned representative: consent, start, the
 * "sharing" status (last sent, accuracy) and Stop. Explains denied or
 * unavailable positions and the limits of browser-based tracking.
 */
export function LocationSharingCard({ pickup, stage }: { pickup: PickupDetail; stage: TrackingStage }) {
  const { state, start, stop } = useLocationSharing(pickup.id, stage);
  const [consenting, setConsenting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const existing = pickup.trackingSessions.find((s) => s.stage === stage && s.status === 'ACTIVE');
  const active = state.status === 'waiting' || state.status === 'sharing' || (state.status === 'unavailable' && state.sessionId !== null);
  const orphaned = !active && state.status !== 'starting' && existing !== undefined;

  const doStop = async (sessionId?: string) => {
    setStopping(true);
    await stop(sessionId);
    setStopping(false);
  };

  return (
    <Card>
      <CardHeader
        title={stage === 'TO_PICKUP' ? 'Share your location on the way' : 'Share your location to the destination'}
        description={stage === 'TO_PICKUP' ? `Lets ${pickup.donor.name} see when you will arrive.` : `Lets ${pickup.ngo.name} follow the food to its destination.`}
        icon={<Navigation className="size-4" aria-hidden="true" />}
        actions={
          active ? (
            <Badge tone="success" dot>
              {state.status === 'sharing' ? 'Sharing location' : 'Starting…'}
            </Badge>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {state.status === 'starting' ? (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <Spinner className="size-4" /> Starting…
          </p>
        ) : null}

        {active ? (
          <div className="space-y-2" aria-live="polite">
            {state.status === 'waiting' ? <p className="text-sm text-slate-300">Waiting for your first GPS position… Allow location access if your browser asks.</p> : null}
            {state.lastSentAt ? (
              <p className="text-sm text-slate-200">
                Last sent at <strong className="text-white">{formatTime(state.lastSentAt)}</strong>
                {state.accuracyM !== null ? <> · accuracy ±{formatMeters(state.accuracyM)}</> : null} · {state.sentCount} position{state.sentCount === 1 ? '' : 's'} sent
              </p>
            ) : null}
            {state.message ? <p className="text-xs text-amber-300">{state.message}</p> : null}
            <Button variant="danger" size="sm" loading={stopping} leftIcon={<Square className="size-3.5" aria-hidden="true" />} onClick={() => void doStop()}>
              Stop sharing
            </Button>
          </div>
        ) : null}

        {state.status === 'denied' ? (
          <Banner tone="danger" title="Location permission was denied" icon={<MapPinOff className="size-5" aria-hidden="true" />} live>
            FoodBridge cannot see your position, so the donor will not see you approaching. To share, allow location for this site in your browser settings and try again. You can still collect: the donor verifies your pass and photo ID.
          </Banner>
        ) : null}
        {state.status === 'unavailable' && !active ? (
          <Banner tone="warning" title="Position unavailable" live>
            {state.message}
          </Banner>
        ) : null}
        {state.status === 'unsupported' ? (
          <Banner tone="warning" title="Location sharing is not available in this browser" live>
            This browser cannot share its location. You can still collect: the donor verifies your pass and photo ID.
          </Banner>
        ) : null}
        {state.status === 'error' ? (
          <Banner tone="danger" live>
            {state.message}
          </Banner>
        ) : null}
        {state.status === 'ended' ? <Banner tone="info">{state.message ?? 'You stopped sharing your location.'}</Banner> : null}

        {orphaned ? (
          <Banner tone="info" title="Sharing is switched on, but this tab is not sending your position">
            This happens after a reload or when the page was closed{existing?.lastRecordedAt ? ` (last position at ${formatTime(existing.lastRecordedAt)})` : ''}. Resume to keep viewers up to date, or stop it.
          </Banner>
        ) : null}

        {!active && state.status !== 'starting' ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConsenting(true)} leftIcon={<LocateFixed className="size-4" aria-hidden="true" />}>
              {orphaned ? 'Resume sharing' : state.status === 'idle' ? 'Start sharing my location' : 'Try again'}
            </Button>
            {orphaned && existing ? (
              <Button variant="outline" loading={stopping} onClick={() => void doStop(existing.id)}>
                Stop sharing
              </Button>
            ) : null}
          </div>
        ) : null}

        <ul className="space-y-1 text-xs text-slate-400">
          <li>Only works while this page is open in the foreground; locking the phone or switching apps pauses it.</li>
          <li>Arriving at the location does not complete anything: the handover needs the donor’s verification and both sides’ confirmation.</li>
        </ul>
      </CardBody>
      {consenting ? (
        <ConsentDialog
          stage={stage}
          donorName={pickup.donor.name}
          ngoName={pickup.ngo.name}
          onClose={() => setConsenting(false)}
          onAccept={() => {
            setConsenting(false);
            void start();
          }}
        />
      ) : null}
    </Card>
  );
}
