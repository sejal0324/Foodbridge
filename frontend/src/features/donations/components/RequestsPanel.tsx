import { Check, Split, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Field, Input, StatusBadge, Textarea, useToast } from '@/components/ui';
import type { DonationDetail, DonationRequestSummary } from '@/types';
import { formatQuantity, formatRelative } from '@/utils/format';
import { useApproveRequest, useRejectRequest } from '../api';
import { SplitSuggestionDialog } from './SplitSuggestionDialog';

/** NGO requests for a donation: approve (full or partial), reject, or get a suggested split. */
export function RequestsPanel({ donation, canAct }: { donation: DonationDetail; canAct: boolean }) {
  const [approving, setApproving] = useState<DonationRequestSummary | null>(null);
  const [rejecting, setRejecting] = useState<DonationRequestSummary | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const pending = donation.requests.filter((r) => r.status === 'PENDING');
  const others = donation.requests.filter((r) => r.status !== 'PENDING');
  const open = ['AVAILABLE', 'PARTIALLY_RESERVED'].includes(donation.status) && donation.availableQuantity > 0;

  return (
    <Card>
      <CardHeader
        title="NGO requests"
        description={pending.length > 0 ? `${pending.length} waiting for your decision · ${formatQuantity(donation.availableQuantity, donation.unit)} still available` : 'Requests from NGOs appear here.'}
        icon={<Users className="size-4" aria-hidden="true" />}
        actions={
          canAct && open && pending.length > 0 ? (
            <Button size="sm" variant="secondary" leftIcon={<Split className="size-4" aria-hidden="true" />} onClick={() => setSplitOpen(true)}>
              Suggest split
            </Button>
          ) : null
        }
      />
      <CardBody>
        {donation.requests.length === 0 ? (
          <EmptyState compact title="No requests yet" description="Matched NGOs have been notified. You will get a notification when one requests this food." />
        ) : (
          <ul className="divide-y divide-white/5">
            {[...pending, ...others].map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white">{r.ngo.name}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-slate-300">
                    Requested {formatQuantity(r.requestedQuantity, donation.unit)}
                    {r.approvedQuantity !== null ? <span className="text-slate-400"> · approved {formatQuantity(r.approvedQuantity, donation.unit)}</span> : null}
                    <span className="text-slate-500"> · {formatRelative(r.createdAt)}</span>
                  </p>
                  {r.message ? <p className="mt-1 text-sm text-slate-400">“{r.message}”</p> : null}
                  {r.decisionReason ? <p className="mt-1 text-xs text-slate-500">Reason: {r.decisionReason}</p> : null}
                </div>
                {canAct && r.status === 'PENDING' && open ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" leftIcon={<X className="size-4" aria-hidden="true" />} onClick={() => setRejecting(r)}>
                      Reject
                    </Button>
                    <Button size="sm" leftIcon={<Check className="size-4" aria-hidden="true" />} onClick={() => setApproving(r)}>
                      Approve
                    </Button>
                  </div>
                ) : null}
                {r.status === 'PENDING' && !open ? <Badge tone="neutral">Nothing left to allocate</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {approving ? <ApproveDialog donation={donation} request={approving} onClose={() => setApproving(null)} /> : null}
      {rejecting ? <RejectDialog request={rejecting} onClose={() => setRejecting(null)} /> : null}
      {splitOpen ? <SplitSuggestionDialog donation={donation} onClose={() => setSplitOpen(false)} /> : null}
    </Card>
  );
}

function ApproveDialog({ donation, request, onClose }: { donation: DonationDetail; request: DonationRequestSummary; onClose: () => void }) {
  const max = Math.min(request.requestedQuantity, donation.availableQuantity);
  const [value, setValue] = useState(String(max));
  const approve = useApproveRequest();
  const toast = useToast();
  const q = Number(value);
  const valid = Number.isInteger(q) && q >= 1 && q <= max;
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Approve ${request.ngo.name}`}
      description={`They requested ${formatQuantity(request.requestedQuantity, donation.unit)}. The quantity you approve is reserved for them immediately.`}
      confirmLabel={valid && q < request.requestedQuantity ? `Approve ${q} (partial)` : 'Approve'}
      confirmDisabled={!valid}
      loading={approve.isPending}
      onConfirm={() =>
        approve
          .mutateAsync({ requestId: request.id, quantity: q === request.requestedQuantity ? undefined : q })
          .then((r) => {
            toast.success('Request approved', `${formatQuantity(r.approvedQuantity, donation.unit)} reserved for ${request.ngo.name}.`);
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Quantity to approve" hint={`Whole number from 1 to ${max}`} error={!valid && value !== '' ? `Enter a whole number from 1 to ${max}` : undefined}>
        <Input type="number" inputMode="numeric" min={1} max={max} step={1} value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}

function RejectDialog({ request, onClose }: { request: DonationRequestSummary; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reject = useRejectRequest();
  const toast = useToast();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Reject ${request.ngo.name}'s request?`}
      description="The NGO is notified. The food stays available for other NGOs."
      tone="danger"
      confirmLabel="Reject request"
      loading={reject.isPending}
      onConfirm={() =>
        reject
          .mutateAsync({ requestId: request.id, reason: reason.trim() || undefined })
          .then(() => {
            toast.success('Request rejected');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason (optional)" hint="Shared with the NGO.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
