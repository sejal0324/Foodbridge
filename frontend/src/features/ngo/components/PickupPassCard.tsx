import { Copy, QrCode, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { QrDisplay } from '@/components/qr';
import { Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, useToast } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { ApiError } from '@/services/apiError';
import type { PickupDetail } from '@/types';
import { formatTime } from '@/utils/format';
import { useGeneratePass } from '../api';
import type { PickupPass } from '../types';
import { copyText } from '../utils';

/** "04:59" for the remaining validity. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The representative's QR pickup pass: an opaque, single-use token with a
 * short expiry. Generating a new pass revokes the previous one. The code is
 * also shown as text for manual entry when the donor's camera cannot read it.
 */
export function PickupPassCard({ pickup }: { pickup: PickupDetail }) {
  const generate = useGeneratePass();
  const toast = useToast();
  const [pass, setPass] = useState<PickupPass | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const now = useNow(1000);
  const remaining = pass ? Date.parse(pass.expiresAt) - now : 0;
  const expired = pass !== null && remaining <= 0;
  const scanned = Boolean(pickup.checks.qrVerifiedAt);

  const run = () =>
    generate
      .mutateAsync(pickup.id)
      .then((p) => {
        setPass(p);
        setConfirmRegenerate(false);
      })
      .catch((e: unknown) => {
        setConfirmRegenerate(false);
        toast.error(e);
      });

  if (scanned) {
    return (
      <Card>
        <CardHeader title="Pickup pass" icon={<ShieldCheck className="size-4" aria-hidden="true" />} />
        <CardBody className="space-y-2 text-sm text-slate-300">
          <p>
            The donor scanned your pass at <strong className="text-white">{formatTime(pickup.checks.qrVerifiedAt)}</strong>.
          </p>
          {pickup.checks.identityConfirmedAt ? <p>Photo ID confirmed at {formatTime(pickup.checks.identityConfirmedAt)}.</p> : <p>Now show the photo ID you registered with your NGO.</p>}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Pickup pass" description="Show this QR code to the donor at the counter." icon={<QrCode className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        {generate.isError && !pass ? <Banner tone="danger">{ApiError.from(generate.error).message}</Banner> : null}
        {!pass ? (
          <>
            <p className="text-sm text-slate-300">Generate the pass when you are close to the pickup: it is valid for a short time and works once. It contains no personal data.</p>
            <Button onClick={() => void run()} loading={generate.isPending} leftIcon={<QrCode className="size-4" aria-hidden="true" />}>
              Generate pass
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className={expired ? 'opacity-30 grayscale' : undefined} aria-hidden={expired}>
              <QrDisplay value={pass.qrPayload} label={`Pickup pass for ${pickup.donation.foodName}`} size={208} />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {expired ? (
                <Banner tone="warning" title="This pass has expired" live>
                  Generate a new pass to continue.
                </Banner>
              ) : (
                <div>
                  <p className="text-sm text-slate-400">Expires in</p>
                  <p className="text-3xl font-semibold text-white tabular-nums" data-testid="pass-countdown">
                    {formatCountdown(remaining)}
                  </p>
                  <p className="text-xs text-slate-500">Valid until {formatTime(pass.expiresAt)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-400">Code for manual entry</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-md bg-black/30 px-2 py-1.5 font-mono text-xs break-all text-slate-100">{pass.qrPayload}</code>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Copy the pass code"
                    onClick={() =>
                      void copyText(pass.qrPayload).then((ok) => (ok ? toast.success('Code copied') : toast.show({ title: 'Copy failed', description: 'Select the code and copy it manually.', tone: 'warning' })))
                    }
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <Button variant="outline" size="sm" leftIcon={<RefreshCw className="size-4" aria-hidden="true" />} loading={generate.isPending && !confirmRegenerate} onClick={() => (expired ? void run() : setConfirmRegenerate(true))}>
                {expired ? 'Generate a new pass' : 'Regenerate pass'}
              </Button>
              <p className="text-xs text-slate-500">A new pass immediately revokes the previous one. After a page reload, generate a new pass.</p>
            </div>
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        title="Replace this pass?"
        description="The current pass stops working immediately. Show the new QR code to the donor."
        confirmLabel="Generate new pass"
        loading={generate.isPending}
        onConfirm={run}
      />
    </Card>
  );
}
