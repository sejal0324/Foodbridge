import { CheckCircle2, ShieldQuestion, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Banner, Button } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import { formatScalarForAction } from '../format';
import { useCancelAssistantAction, useConfirmAssistantAction } from '../api';

export type ActionStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

export interface PendingActionCardProps {
  actionId: number;
  summary: string;
  payload: Record<string, unknown>;
  status: ActionStatus;
  expiresInMinutes?: number;
  onStatusChange?: (status: ActionStatus) => void;
}

/**
 * A state-changing request drafted by the assistant. Nothing happens until the
 * user confirms; the backend then executes it with the user's own permissions.
 */
export function PendingActionCard({ actionId, summary, payload, status: initialStatus, expiresInMinutes, onStatusChange }: PendingActionCardProps) {
  const [status, setStatus] = useState<ActionStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirmAssistantAction();
  const cancel = useCancelAssistantAction();
  const update = (s: ActionStatus) => {
    setStatus(s);
    onStatusChange?.(s);
  };

  return (
    <section aria-label="Action waiting for your confirmation" className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
      <div className="flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">Needs your confirmation</p>
            {status !== 'PENDING' ? (
              <Badge tone={status === 'CONFIRMED' ? 'success' : status === 'FAILED' ? 'danger' : 'neutral'}>{status.toLowerCase()}</Badge>
            ) : expiresInMinutes ? (
              <Badge tone="warning">expires in {expiresInMinutes} min</Badge>
            ) : null}
          </div>
          <p className="text-sm text-slate-200">{summary}</p>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {Object.entries(payload).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-slate-400">{k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}:</dt>
                <dd className="text-slate-200">{formatScalarForAction(v)}</dd>
              </div>
            ))}
          </dl>
          {error ? (
            <Banner tone="danger" live>
              {error}
            </Banner>
          ) : null}
          {status === 'PENDING' ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={confirm.isPending}
                disabled={cancel.isPending}
                leftIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setError(null);
                  confirm.mutate(actionId, {
                    onSuccess: () => update('CONFIRMED'),
                    onError: (e) => {
                      const ae = ApiError.from(e);
                      setError(ae.message);
                      if (ae.code === 'ACTION_EXPIRED') update('EXPIRED');
                      if (ae.code === 'ACTION_NOT_PENDING') update('CANCELLED');
                    },
                  });
                }}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={cancel.isPending}
                disabled={confirm.isPending}
                leftIcon={<XCircle className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setError(null);
                  cancel.mutate(actionId, { onSuccess: () => update('CANCELLED'), onError: (e) => setError(ApiError.from(e).message) });
                }}
              >
                Cancel
              </Button>
            </div>
          ) : status === 'CONFIRMED' ? (
            <p role="status" className="text-sm text-emerald-300">
              Done: the request was created.
            </p>
          ) : (
            <p role="status" className="text-sm text-slate-400">
              Nothing was changed.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
