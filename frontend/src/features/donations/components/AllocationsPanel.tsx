import { PackageCheck, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Field, StatusBadge, Textarea, useToast } from '@/components/ui';
import type { DonationAllocationSummary, DonationDetail, Pickup } from '@/types';
import { formatQuantity, formatRelative } from '@/utils/format';
import { useCancelAllocation } from '../api';

const CANCELLABLE = ['RESERVED', 'PICKUP_ASSIGNED'];

/** Reservations made from this donation, with their pickups and a cancel action. */
export function AllocationsPanel({ donation, pickups, canAct }: { donation: DonationDetail; pickups: Pickup[]; canAct: boolean }) {
  const [cancelling, setCancelling] = useState<DonationAllocationSummary | null>(null);
  const pickupFor = (allocationId: string) => pickups.filter((p) => p.allocationId === allocationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return (
    <Card>
      <CardHeader title="Reservations" description="Quantities reserved for NGOs and their pickups." icon={<PackageCheck className="size-4" aria-hidden="true" />} />
      <CardBody>
        {donation.allocations.length === 0 ? (
          <EmptyState compact title="Nothing reserved yet" description="Approving a request reserves food for that NGO." />
        ) : (
          <ul className="divide-y divide-white/5">
            {donation.allocations.map((a) => {
              const pickup = pickupFor(a.id);
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white">{a.ngo.name}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-slate-300">
                      {formatQuantity(a.quantity, donation.unit)} reserved
                      {a.handedOverQuantity !== null ? <span className="text-slate-400"> · {formatQuantity(a.handedOverQuantity, donation.unit)} handed over</span> : null}
                      <span className="text-slate-500"> · {formatRelative(a.createdAt)}</span>
                    </p>
                    {pickup ? (
                      <Link to={`/donor/pickups/${pickup.id}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-brand-300 hover:underline">
                        <Truck className="size-3.5" aria-hidden="true" /> Pickup by {pickup.representative.name} · <StatusBadge status={pickup.status} />
                      </Link>
                    ) : a.status === 'RESERVED' ? (
                      <p className="mt-1 text-xs text-slate-500">Waiting for the NGO to assign a representative.</p>
                    ) : null}
                  </div>
                  {canAct && CANCELLABLE.includes(a.status) ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(a)}>
                      Cancel reservation
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {cancelling ? <CancelAllocationDialog allocation={cancelling} unit={donation.unit} onClose={() => setCancelling(null)} /> : null}
    </Card>
  );
}

function CancelAllocationDialog({ allocation, unit, onClose }: { allocation: DonationAllocationSummary; unit: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useCancelAllocation();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone="danger"
      title={`Cancel ${allocation.ngo.name}'s reservation?`}
      description={`${formatQuantity(allocation.quantity, unit)} return to the available quantity and the NGO is notified. Any assigned pickup is cancelled.`}
      confirmLabel="Cancel reservation"
      cancelLabel="Keep it"
      confirmDisabled={reason.trim().length < 3}
      loading={cancel.isPending}
      onConfirm={() =>
        cancel
          .mutateAsync({ allocationId: allocation.id, reason: reason.trim() })
          .then(() => {
            toast.success('Reservation cancelled');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason" hint="At least 3 characters; shared with the NGO." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
