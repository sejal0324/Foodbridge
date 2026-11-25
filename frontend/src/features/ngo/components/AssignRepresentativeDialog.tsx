import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LocationPicker, addressLineFrom } from '@/components/map';
import { Banner, Button, ButtonLink, Checkbox, Dialog, Field, Input, Select, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import type { Allocation, LatLng } from '@/types';
import { formatDateTime, formatQuantity, fromIstInputValue, istInputToMillis } from '@/utils/format';
import { ID_DOCUMENT_LABELS } from '@/utils/labels';
import { useAssignPickup, useRepresentatives } from '../api';

/**
 * Assign (or reassign, before verification starts) a representative to a
 * reserved allocation. Reassignment revokes the previous pass and ends its tracking.
 */
export function AssignRepresentativeDialog({ allocation, onClose }: { allocation: Allocation; onClose: () => void }) {
  const reps = useRepresentatives();
  const assign = useAssignPickup();
  const toast = useToast();
  const navigate = useNavigate();
  const active = (reps.data ?? []).filter((r) => r.status === 'ACTIVE');
  const reassigning = Boolean(allocation.pickup && ['ASSIGNED', 'EN_ROUTE'].includes(allocation.pickup.status));
  const [repId, setRepId] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [otherDestination, setOtherDestination] = useState(false);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedRep = repId || (active.length === 1 ? (active[0]?.id ?? '') : '');

  const scheduledError = scheduled && Number.isNaN(istInputToMillis(scheduled)) ? 'Enter a date and time' : undefined;
  const destinationError = otherDestination && (!destination || destinationAddress.trim().length < 5) ? 'Choose a point and enter an address (at least 5 characters)' : undefined;

  const submit = () => {
    setError(null);
    if (!selectedRep || scheduledError || destinationError) return;
    assign.mutate(
      {
        allocationId: allocation.id,
        representativeId: selectedRep,
        ...(scheduled ? { scheduledPickupAt: fromIstInputValue(scheduled) } : {}),
        ...(otherDestination && destination ? { destination: { location: destination, address: destinationAddress.trim() } } : {}),
      },
      {
        onSuccess: (pickup) => {
          toast.show({ title: reassigning ? 'Representative reassigned' : 'Representative assigned', description: `${pickup.representative.name} will collect ${allocation.foodName}. The donor has been notified.`, tone: 'success', action: { label: 'Open pickup', onClick: () => navigate(`/ngo/pickups/${pickup.id}`) } });
          onClose();
        },
        onError: (e) => setError(ApiError.from(e).message),
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={reassigning ? 'Reassign the pickup' : 'Assign a representative'}
      description={`${formatQuantity(allocation.quantity, allocation.unit)} of ${allocation.foodName} from ${allocation.donor.name}. Collect before ${formatDateTime(allocation.pickupDeadline)}.`}
      dismissible={!assign.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={assign.isPending} disabled={!selectedRep || Boolean(scheduledError) || Boolean(destinationError)} leftIcon={<UserPlus className="size-4" aria-hidden="true" />}>
            {reassigning ? 'Reassign' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Banner tone="danger" live>
            {error}
          </Banner>
        ) : null}
        {reassigning ? (
          <Banner tone="warning">
            {allocation.pickup ? 'This pickup already has a representative. ' : ''}Reassigning cancels the current assignment, revokes its QR pass and ends its location sharing. It is only possible before the donor starts verification.
          </Banner>
        ) : null}
        {reps.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : reps.isError ? (
          <Banner tone="danger">{ApiError.from(reps.error).message}</Banner>
        ) : active.length === 0 ? (
          <Banner
            tone="warning"
            title="No active representatives"
            actions={
              <ButtonLink to="/ngo/representatives" size="sm" variant="secondary">
                Manage representatives
              </ButtonLink>
            }
          >
            Add yourself or invite someone who will collect food for your NGO.
          </Banner>
        ) : (
          <Field label="Representative" required hint="Only active representatives can collect. The donor checks their QR pass and photo ID at pickup.">
            <Select
              value={selectedRep}
              onChange={(e) => setRepId(e.target.value)}
              placeholder="Choose a representative"
              options={active.map((r) => ({ value: r.id, label: `${r.fullName} · ${ID_DOCUMENT_LABELS[r.idDocumentType] ?? r.idDocumentType} …${r.idDocumentLast4}${r.phone ? '' : ' (no phone)'}` }))}
            />
          </Field>
        )}
        <Field label="Planned pickup time (IST)" error={scheduledError} hint="Optional; shared with the donor.">
          <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
        </Field>
        <Checkbox
          label="Deliver somewhere other than our NGO address"
          description="By default the food goes to your NGO’s location. Choose another destination, e.g. a community kitchen."
          checked={otherDestination}
          onChange={(e) => setOtherDestination(e.target.checked)}
        />
        {otherDestination ? (
          <div className="space-y-3">
            <LocationPicker
              value={destination}
              onChange={setDestination}
              label="Destination"
              height={220}
              onAddressSelect={(r) => {
                if (!destinationAddress.trim()) setDestinationAddress(addressLineFrom(r));
              }}
            />
            <Field label="Destination address" error={destinationError} required>
              <Input value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} maxLength={300} />
            </Field>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
