import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, renderWithProviders } from '../../../../tests/utils';
import { manualPaymentSchema } from '../schemas';
import type { Invoice } from '../types';
import { ManualPaymentDialog } from './ManualPaymentDialog';

const invoice: Invoice = {
  id: '7c1d0e8a-0000-4000-8000-000000000009',
  ngo: { id: 'n1', name: 'Helping Hands Foundation' },
  invoiceNumber: 'FB-INV-2026-000001',
  periodStart: '2026-11-03',
  periodEnd: '2026-11-03',
  subtotal: 300,
  taxTotal: 0,
  total: 300,
  amountPaid: 100,
  currency: 'INR',
  status: 'ISSUED',
  issuedAt: '2026-11-03T12:00:00Z',
  dueAt: '2026-11-18T12:00:00Z',
  paidAt: null,
};

describe('manual (offline) payments', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('schema: the amount must be positive and within the outstanding balance', () => {
    const schema = manualPaymentSchema(200);
    const ref = 'UTR 1234';
    expect(schema.safeParse({ amount: '0', reference: ref }).success).toBe(false);
    expect(schema.safeParse({ amount: '0.00', reference: ref }).success).toBe(false);
    expect(schema.safeParse({ amount: '-5', reference: ref }).success).toBe(false);
    expect(schema.safeParse({ amount: '', reference: ref }).success).toBe(false);
    expect(schema.safeParse({ amount: '200.01', reference: ref }).success).toBe(false);
    expect(schema.safeParse({ amount: '10.555', reference: ref }).success).toBe(false);
    expect(schema.safeParse({ amount: '0.01', reference: ref }).success).toBe(true);
    expect(schema.safeParse({ amount: '200', reference: ref }).success).toBe(true);
    expect(schema.safeParse({ amount: '50', reference: 'x' }).success).toBe(false);
  });

  it('is labelled as an offline payment, rejects zero, and posts the payment', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 201, data: { data: { paymentId: 'p1' } } }));
    restore = api.restore;
    const onClose = vi.fn();
    renderWithProviders(<ManualPaymentDialog invoice={invoice} onClose={onClose} />);

    expect(screen.getByText(/labelled/)).toHaveTextContent('labelled MANUAL');
    const amount = screen.getByLabelText(/Amount received/);
    expect(amount).toHaveValue(200); // prefilled with the outstanding balance
    await user.clear(amount);
    await user.type(amount, '0');
    await user.type(screen.getByLabelText(/Reference/), 'NEFT UTR 998877');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('The amount must be greater than zero')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);

    await user.clear(amount);
    await user.type(amount, '150.5');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /admin/payments/manual']);
    expect(api.calls[0]?.body).toEqual({ invoiceId: invoice.id, amount: 150.5, reference: 'NEFT UTR 998877' });
  });

  it('shows OVERPAYMENT from the server on the amount field', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(422, 'OVERPAYMENT', 'Amount exceeds the outstanding INR 200.00.'));
    restore = api.restore;
    renderWithProviders(<ManualPaymentDialog invoice={invoice} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Reference/), 'NEFT UTR 998877');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('Amount exceeds the outstanding INR 200.00.')).toBeInTheDocument();
  });
});
