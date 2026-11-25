import { CheckCircle2, Info, Wand2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Banner, Button, Card, CardBody, CardHeader, Dialog, useToast } from '@/components/ui';
import { FeeEstimateCard } from '@/features/billing';
import { useAllocationProposal } from '@/features/matching';
import { ApiError } from '@/services/apiError';
import type { AllocationProposal, Offer, Unit } from '@/types';
import { formatQuantity } from '@/utils/format';
import { useAcceptOffersSequentially } from '../api';

const SOURCE_LABEL: Record<string, { label: string; tone: 'brand' | 'warning' | 'neutral'; note: string }> = {
  AI_OPTIMIZER: { label: 'AI optimiser', tone: 'brand', note: 'Computed by the allocation optimiser (most quantity first, then better matches, then fewer pickups).' },
  FALLBACK_FIRST_COME: { label: 'First-come fallback', tone: 'warning', note: 'The optimiser was unavailable, so offers are proposed in the order they arrived.' },
  NONE: { label: 'No proposal', tone: 'neutral', note: 'There was nothing to allocate.' },
};

interface ApplyResult {
  offerId: string;
  donorName: string;
  ok: boolean;
  quantity: number;
  message: string;
}

/**
 * "Suggest which offers to accept": a proposal only (POST /matching/allocate).
 * Applying it accepts each proposed offer in turn with its quantity and shows
 * the outcome of every acceptance; nothing happens without a confirmation.
 */
export function AllocationSuggestion({ requestId, offers, unit, canAccept, hasProposed }: { requestId: string; offers: Offer[]; unit: Unit; canAccept: boolean; hasProposed: boolean }) {
  const proposal = useAllocationProposal();
  const apply = useAcceptOffersSequentially();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const data: AllocationProposal | undefined = proposal.data;
  const byId = new Map(offers.map((o) => [o.id, o]));
  const items = (data?.allocations ?? [])
    .filter((a): a is typeof a & { offerId: string } => typeof a.offerId === 'string' && a.quantity > 0)
    .map((a) => ({ ...a, offer: byId.get(a.offerId) }));
  const applicable = items.filter((i) => i.offer?.status === 'PROPOSED');
  const total = applicable.reduce((s, i) => s + i.quantity, 0);
  const source = data ? (SOURCE_LABEL[data.source] ?? { label: data.source, tone: 'neutral' as const, note: '' }) : null;

  const run = async () => {
    const out = await apply.mutateAsync(applicable.map((i) => ({ offerId: i.offerId, quantity: i.quantity })));
    setResults(
      out.map((r) => {
        const item = applicable.find((i) => i.offerId === r.offerId);
        return {
          offerId: r.offerId,
          donorName: item?.donorName ?? item?.offer?.donor.name ?? 'Donor',
          ok: r.ok,
          quantity: r.ok ? (r.accepted?.acceptedQuantity ?? item?.quantity ?? 0) : (item?.quantity ?? 0),
          message: r.ok ? 'Accepted' : ApiError.from(r.error).message,
        };
      }),
    );
    setConfirming(false);
    const failed = out.filter((r) => !r.ok).length;
    if (failed === 0) toast.success('Suggestion applied', `${out.length} offer${out.length === 1 ? '' : 's'} accepted.`);
    else toast.show({ title: 'Suggestion partly applied', description: `${out.length - failed} accepted, ${failed} failed. See the results below.`, tone: 'warning' });
  };

  return (
    <Card>
      <CardHeader
        title="Suggest which offers to accept"
        description="A recommendation for covering the need with the offers you have. Nothing is accepted until you apply it."
        icon={<Wand2 className="size-4" aria-hidden="true" />}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!hasProposed}
            title={hasProposed ? undefined : 'No offers are waiting for a decision'}
            loading={proposal.isPending}
            onClick={() => {
              setResults(null);
              proposal.mutate({ assistanceRequestId: requestId }, { onError: (e) => toast.error(e) });
            }}
          >
            {data ? 'Suggest again' : 'Suggest'}
          </Button>
        }
      />
      {!data && !hasProposed ? (
        <CardBody>
          <p className="text-sm text-slate-400">No offers are waiting for a decision right now.</p>
        </CardBody>
      ) : null}
      {data && source ? (
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={source.tone}>{source.label}</Badge>
            <Badge tone="neutral">{data.status.replace(/_/g, ' ').toLowerCase()}</Badge>
            {data.totalAllocated !== undefined ? <span className="text-sm text-slate-300">{formatQuantity(data.totalAllocated, unit)} proposed in total</span> : null}
          </div>
          <p className="text-xs text-slate-400">{source.note}</p>
          <p className="text-sm leading-relaxed text-slate-200">{data.explanation}</p>
          {data.reasons.length > 0 ? (
            <ul className="space-y-1 text-xs text-slate-400">
              {data.reasons.map((r) => (
                <li key={r} className="flex gap-1.5">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
          {items.length === 0 ? (
            <p className="text-sm text-slate-400">No offers are proposed.</p>
          ) : (
            <ul className="divide-y divide-white/5 rounded-lg border border-white/10" aria-label="Proposed quantities">
              {items.map((i) => {
                const result = results?.find((r) => r.offerId === i.offerId);
                return (
                  <li key={i.offerId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-slate-200">
                      {i.donorName ?? i.offer?.donor.name ?? 'Donor'} {i.offer ? <span className="text-slate-400">· {i.offer.foodName}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-white tabular-nums">
                        {formatQuantity(i.quantity, unit)}
                        {i.offered !== undefined ? <span className="text-slate-500"> of {i.offered}</span> : null}
                      </span>
                      {result ? (
                        result.ok ? (
                          <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden="true" />}>
                            {result.message} {result.quantity}
                          </Badge>
                        ) : (
                          <Badge tone="danger" icon={<XCircle className="size-3" aria-hidden="true" />}>
                            Failed
                          </Badge>
                        )
                      ) : i.offer && i.offer.status !== 'PROPOSED' ? (
                        <Badge tone="neutral">already {i.offer.status.toLowerCase()}</Badge>
                      ) : null}
                    </span>
                    {result && !result.ok ? <p className="w-full text-xs text-red-300">{result.message}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {canAccept && applicable.length > 0 && !results ? (
            <Button onClick={() => setConfirming(true)}>Apply suggestion</Button>
          ) : !canAccept && applicable.length > 0 ? (
            <Banner tone="info">This request is no longer open, so offers cannot be accepted.</Banner>
          ) : null}
        </CardBody>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Apply this suggestion?"
        description={`Accepts ${applicable.length} offer${applicable.length === 1 ? '' : 's'} one after another, ${formatQuantity(total, unit)} in total. Each result is shown separately.`}
        dismissible={!apply.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={apply.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void run()} loading={apply.isPending}>
              Accept {applicable.length} offer{applicable.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <ul className="mb-4 space-y-1 text-sm text-slate-200">
          {applicable.map((i) => (
            <li key={i.offerId}>
              {i.donorName ?? i.offer?.donor.name}: {formatQuantity(i.quantity, unit)}
            </li>
          ))}
        </ul>
        {total > 0 ? <FeeEstimateCard unit={unit} quantity={total} /> : null}
      </Dialog>
    </Card>
  );
}
