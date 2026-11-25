import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Banner, Button, Dialog, ErrorState, Input, LoadingState, useToast } from '@/components/ui';
import { useAllocationProposal } from '@/features/matching/api';
import type { DonationDetail } from '@/types';
import { formatQuantity } from '@/utils/format';
import { useApproveBatch } from '../api';

/**
 * Asks the optimiser how to split the available quantity across pending
 * requests, lets the donor adjust it, then approves all in one transaction.
 */
export function SplitSuggestionDialog({ donation, onClose }: { donation: DonationDetail; onClose: () => void }) {
  const proposal = useAllocationProposal();
  const approve = useApproveBatch(donation.id);
  const toast = useToast();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const { mutate } = proposal;
  const requested = useRef(false);

  useEffect(() => {
    // Run once per dialog (the endpoint is rate-limited; StrictMode double-invokes effects in development).
    if (requested.current) return;
    requested.current = true;
    mutate(
      { donationId: donation.id },
      { onSuccess: (p) => setQuantities(Object.fromEntries(p.allocations.filter((a) => a.requestId).map((a) => [a.requestId as string, String(a.quantity)]))) },
    );
  }, [mutate, donation.id]);

  const p = proposal.data;
  const rows = p?.allocations.filter((a) => a.requestId) ?? [];
  const parsed = rows.map((a) => ({ requestId: a.requestId as string, quantity: Number(quantities[a.requestId as string] ?? 0), requested: a.requested ?? a.quantity, ngoName: a.ngoName ?? 'NGO' }));
  const total = parsed.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0);
  const invalid = parsed.some((r) => !Number.isInteger(r.quantity) || r.quantity < 0 || r.quantity > r.requested) || total > donation.availableQuantity;
  const toApprove = parsed.filter((r) => r.quantity > 0);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Suggested split"
      description={`Divide ${formatQuantity(donation.availableQuantity, donation.unit)} across the pending requests. Nothing is reserved until you approve.`}
      dismissible={!approve.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!p || invalid || toApprove.length === 0}
            loading={approve.isPending}
            onClick={() =>
              approve.mutate(
                toApprove.map((r) => ({ requestId: r.requestId, quantity: r.quantity })),
                {
                  onSuccess: () => {
                    toast.success('Requests approved', `${formatQuantity(total, donation.unit)} reserved across ${toApprove.length} NGO${toApprove.length === 1 ? '' : 's'}.`);
                    onClose();
                  },
                  onError: (e) => toast.error(e),
                },
              )
            }
          >
            Approve {toApprove.length > 0 ? `${toApprove.length} request${toApprove.length === 1 ? '' : 's'}` : ''}
          </Button>
        </>
      }
    >
      {proposal.isPending ? (
        <LoadingState label="Calculating a split…" />
      ) : proposal.isError ? (
        <ErrorState error={proposal.error} compact onRetry={() => mutate({ donationId: donation.id })} />
      ) : p ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {p.source === 'AI_OPTIMIZER' ? (
              <Badge tone="brand" icon={<Sparkles className="size-3" aria-hidden="true" />}>
                AI optimiser
              </Badge>
            ) : p.source === 'FALLBACK_FIRST_COME' ? (
              <Badge tone="warning">Fallback: first come, first served</Badge>
            ) : (
              <Badge tone="neutral">No suggestion</Badge>
            )}
            {p.status ? <Badge tone="neutral">{p.status.replace(/_/g, ' ').toLowerCase()}</Badge> : null}
          </div>
          <p className="text-sm leading-relaxed text-slate-300">{p.explanation}</p>
          {p.source === 'FALLBACK_FIRST_COME' ? <Banner tone="warning">The optimiser is unavailable, so requests are filled in the order they arrived. Review before approving.</Banner> : null}
          {p.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
              {p.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {rows.length > 0 ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Proposed quantities per NGO</caption>
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th scope="col" className="py-2 font-medium">
                    NGO
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Requested
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Approve
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {parsed.map((r) => (
                  <tr key={r.requestId}>
                    <td className="py-2 text-slate-200">{r.ngoName}</td>
                    <td className="py-2 text-right text-slate-400 tabular-nums">{r.requested}</td>
                    <td className="py-2 text-right">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={r.requested}
                        step={1}
                        value={quantities[r.requestId] ?? ''}
                        onChange={(e) => setQuantities((q) => ({ ...q, [r.requestId]: e.target.value }))}
                        className="ml-auto w-24 text-right"
                        aria-label={`Quantity for ${r.ngoName}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 text-sm font-medium text-white">Total</td>
                  <td />
                  <td className="pt-3 text-right text-sm font-semibold text-white tabular-nums">
                    {total} / {donation.availableQuantity}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : null}
          {invalid ? <p className="text-sm text-red-300">Each quantity must be a whole number up to what was requested, and the total cannot exceed what is available.</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
