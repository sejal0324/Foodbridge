import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, authValue, mockApi, ok, renderWithProviders, type FakeRequest } from '../../../tests/utils';
import { PayInvoiceDialog } from './components/PayInvoiceDialog';
import { RAZORPAY_CHECKOUT_SRC, type RazorpayOptions } from './razorpay';
import { ngoOwner } from './testing';
import type { Invoice } from './types';

const invoice: Invoice = {
  id: 'inv-1',
  ngo: { id: 'ngo-1', name: 'Helping Hands Foundation' },
  invoiceNumber: 'FB-INV-2026-000001',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  subtotal: 300,
  taxTotal: 0,
  total: 300,
  amountPaid: 0,
  currency: 'INR',
  status: 'ISSUED',
  issuedAt: '2026-11-01T00:00:00.000Z',
  dueAt: '2026-11-15T00:00:00.000Z',
  paidAt: null,
};

const posts = (calls: FakeRequest[]) => calls.filter((c) => c.method === 'POST').map((c) => c.url);

describe('paying an invoice', () => {
  let restore: () => void = () => undefined;
  afterEach(() => {
    restore();
    delete window.Razorpay;
    document.querySelectorAll(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`).forEach((s) => s.remove());
  });

  it('explains PAYMENTS_NOT_CONFIGURED and never presents it as a success', async () => {
    const api = mockApi(() =>
      apiError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payment is not configured on this FoodBridge instance. The invoice stays payable; an administrator can record a bank transfer or other manual payment.'),
    );
    restore = api.restore;
    renderWithProviders(<PayInvoiceDialog invoice={invoice} onClose={vi.fn()} />, { auth: authValue({ user: ngoOwner }) });

    expect(await screen.findByText('Online payment isn’t configured')).toBeInTheDocument();
    expect(screen.getByText(/Your invoice stays payable: contact the FoodBridge administrator to pay by bank transfer/)).toBeInTheDocument();
    expect(screen.getByText(/nothing was charged/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting confirmation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Paid$/)).not.toBeInTheDocument();
    // Checkout is loaded only when the backend returns an order.
    expect(document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`)).toBeNull();
    expect(posts(api.calls)).toEqual(['/billing/payments']);
    expect(api.calls[0]?.body).toEqual({ invoiceId: 'inv-1' });
  });

  it('opens Razorpay for an order, verifies the callback and shows the payment as pending only', async () => {
    let options: RazorpayOptions | null = null;
    const open = vi.fn(() => {
      options?.handler({ razorpay_order_id: 'order_123', razorpay_payment_id: 'pay_456', razorpay_signature: 'sig_0123456789abcdef' });
    });
    window.Razorpay = class {
      constructor(o: RazorpayOptions) {
        options = o;
      }
      open = open;
      on = vi.fn();
    } as unknown as NonNullable<typeof window.Razorpay>;
    const api = mockApi((req) => {
      if (req.url === '/billing/payments') return { status: 201, data: { data: { provider: 'RAZORPAY', keyId: 'rzp_test_key', orderId: 'order_123', amount: 300, amountPaise: 30000, currency: 'INR', invoiceNumber: invoice.invoiceNumber } } };
      if (req.url === '/billing/payments/verify') return ok({ status: 'PENDING_CONFIRMATION', message: 'Payment received by the provider; it will show as paid once the provider confirms capture.' });
      return ok([]);
    });
    restore = api.restore;
    renderWithProviders(<PayInvoiceDialog invoice={invoice} onClose={vi.fn()} />, { auth: authValue({ user: ngoOwner }) });

    expect(await screen.findByText('Payment received; awaiting confirmation')).toBeInTheDocument();
    expect(options).toMatchObject({ key: 'rzp_test_key', order_id: 'order_123', amount: 30000, currency: 'INR' });
    expect(open).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.calls.find((c) => c.url === '/billing/payments/verify')?.body).toEqual({ orderId: 'order_123', paymentId: 'pay_456', signature: 'sig_0123456789abcdef' }));
    expect(screen.getByText(/The invoice is marked as paid only after that confirmation/)).toBeInTheDocument();
  });
});
