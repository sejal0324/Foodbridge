import { Clock, CreditCard, Landmark, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog, Spinner } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { ApiError } from '@/services/apiError';
import { formatINR } from '@/utils/format';
import { useCreatePayment, useVerifyPayment } from '../api';
import { loadRazorpay } from '../razorpay';
import type { Invoice } from '../types';

type Phase =
  | { kind: 'creating' }
  | { kind: 'not-configured'; message: string }
  | { kind: 'checkout' }
  | { kind: 'verifying' }
  | { kind: 'awaiting-confirmation'; message: string }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string };

/**
 * Pays an invoice online. POST /billing/payments creates a Razorpay order
 * (or answers 503 PAYMENTS_NOT_CONFIGURED); Checkout is loaded only then.
 * A completed checkout is verified (POST /billing/payments/verify) and stays
 * PENDING until the provider's webhook confirms capture: this dialog never
 * claims the invoice is paid.
 */
export function PayInvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const user = useCurrentUser();
  const create = useCreatePayment();
  const verify = useVerifyPayment();
  const [phase, setPhase] = useState<Phase>({ kind: 'creating' });
  const started = useRef(false);
  const due = Math.round((invoice.total - invoice.amountPaid) * 100) / 100;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create
      .mutateAsync(invoice.id)
      .then(async (order) => {
        const Razorpay = await loadRazorpay();
        setPhase({ kind: 'checkout' });
        const checkout = new Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amountPaise,
          currency: order.currency,
          name: 'FoodBridge',
          description: `Service fees · invoice ${order.invoiceNumber}`,
          prefill: { name: user.fullName, email: user.email, ...(user.phone ? { contact: user.phone } : {}) },
          notes: { invoiceId: invoice.id },
          theme: { color: '#2E7D32' },
          modal: { ondismiss: () => setPhase((p) => (p.kind === 'checkout' ? { kind: 'dismissed' } : p)) },
          handler: (response) => {
            setPhase({ kind: 'verifying' });
            verify
              .mutateAsync({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature })
              .then((r) => setPhase({ kind: 'awaiting-confirmation', message: r.message }))
              .catch((e: unknown) => setPhase({ kind: 'failed', message: ApiError.from(e).message }));
          },
        });
        checkout.on('payment.failed', (r) => setPhase({ kind: 'failed', message: r.error?.description ?? 'The payment failed. Nothing was charged; the invoice is still payable.' }));
        checkout.open();
      })
      .catch((e: unknown) => {
        const err = ApiError.from(e);
        if (err.code === 'PAYMENTS_NOT_CONFIGURED') setPhase({ kind: 'not-configured', message: err.message });
        else setPhase({ kind: 'failed', message: err.message || (e instanceof Error ? e.message : 'The payment could not be started.') });
      });
  }, [create, verify, invoice.id, user.fullName, user.email, user.phone]);

  const busy = phase.kind === 'creating' || phase.kind === 'verifying';
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Pay invoice ${invoice.invoiceNumber}`}
      description={`Amount due: ${formatINR(due)}`}
      footer={
        <Button variant={phase.kind === 'awaiting-confirmation' ? 'primary' : 'ghost'} onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      <div aria-live="polite">
        {phase.kind === 'creating' ? (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <Spinner className="size-4" /> Preparing the payment…
          </p>
        ) : null}
        {phase.kind === 'checkout' ? (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <CreditCard className="size-4 text-slate-400" aria-hidden="true" /> Complete the payment in the Razorpay window.
          </p>
        ) : null}
        {phase.kind === 'verifying' ? (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <Spinner className="size-4" /> Checking the payment with FoodBridge…
          </p>
        ) : null}
        {phase.kind === 'not-configured' ? (
          <Banner tone="warning" title="Online payment isn’t configured" icon={<Landmark className="size-5" aria-hidden="true" />}>
            <p>This FoodBridge instance cannot take online payments yet, so nothing was charged. Your invoice stays payable: contact the FoodBridge administrator to pay by bank transfer, and they will record the payment.</p>
            <p className="mt-2 text-xs opacity-80">{phase.message}</p>
          </Banner>
        ) : null}
        {phase.kind === 'awaiting-confirmation' ? (
          <Banner tone="info" title="Payment received; awaiting confirmation" icon={<Clock className="size-5" aria-hidden="true" />}>
            <p>{phase.message}</p>
            <p className="mt-2 text-xs opacity-80">The payment shows as pending until Razorpay confirms it. The invoice is marked as paid only after that confirmation.</p>
          </Banner>
        ) : null}
        {phase.kind === 'dismissed' ? <Banner tone="info">The payment window was closed before paying. Nothing was charged; the invoice is still payable.</Banner> : null}
        {phase.kind === 'failed' ? (
          <Banner tone="danger" title="The payment did not go through" icon={<XCircle className="size-5" aria-hidden="true" />}>
            {phase.message} The invoice is still payable.
          </Banner>
        ) : null}
      </div>
    </Dialog>
  );
}
