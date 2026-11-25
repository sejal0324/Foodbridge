import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authValue, mockApi, ok, renderWithProviders, type FakeRequest } from '../../../tests/utils';
import { AcceptOfferDialog } from './components/OfferDialogs';
import { feeFor, ngoOwner, offer } from './testing';

function backend() {
  return mockApi((req: FakeRequest) => {
    if (req.method === 'GET' && req.url === '/billing/fee-estimate') {
      const { unit, quantity } = req.params as { unit: string; quantity: number };
      return ok(feeFor(unit, Number(quantity)));
    }
    if (req.method === 'PATCH' && req.url === `/offers/${offer.id}/accept`) {
      const q = (req.body as { quantity: number }).quantity;
      return ok({ ...offer, status: 'ACCEPTED', acceptedQuantity: q, feeEstimate: feeFor('MEALS', q) });
    }
    return { status: 404, data: { error: { code: 'NOT_FOUND', message: 'unexpected' } } };
  });
}

const accepts = (calls: FakeRequest[]) => calls.filter((c) => c.method === 'PATCH');
/** The "Estimated total" amount of the fee card. */
const estimatedTotal = () => screen.getByText('Estimated total').nextElementSibling?.textContent;

describe('accepting an offer', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('shows the service-fee estimate before anything is accepted', async () => {
    const api = backend();
    restore = api.restore;
    renderWithProviders(<AcceptOfferDialog offer={offer} unit="MEALS" remaining={150} onClose={vi.fn()} />, { auth: authValue({ user: ngoOwner }) });

    const dialog = screen.getByRole('dialog');
    // Defaults to the whole offer (60), capped by what is still needed.
    expect(within(dialog).getByRole('spinbutton')).toHaveValue(60);
    expect(await within(dialog).findByText('Service fee estimate')).toBeInTheDocument();
    await waitFor(() => expect(estimatedTotal()).toBe('₹300.00'), { timeout: 2000 });
    expect(within(dialog).getByText(/60 meals × ₹5.00/)).toBeInTheDocument();
    expect(accepts(api.calls)).toHaveLength(0);
  });

  it('accepts a partial quantity, re-estimating the fee first', async () => {
    const user = userEvent.setup();
    const api = backend();
    restore = api.restore;
    renderWithProviders(<AcceptOfferDialog offer={offer} unit="MEALS" remaining={150} onClose={vi.fn()} />, { auth: authValue({ user: ngoOwner }) });
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '40');

    await waitFor(() => expect(estimatedTotal()).toBe('₹200.00'), { timeout: 2000 });
    expect(api.calls.some((c) => c.url === '/billing/fee-estimate' && (c.params as { quantity: number }).quantity === 40)).toBe(true);
    expect(accepts(api.calls)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Accept 40 meals' }));
    expect(await screen.findByRole('heading', { name: 'Offer accepted' })).toBeInTheDocument();
    expect(accepts(api.calls).map((c) => c.body)).toEqual([{ quantity: 40 }]);
    // The fee estimate returned by the API is shown with the result.
    expect(screen.getByText('Fee if this collection completes')).toBeInTheDocument();
    expect(screen.getByText(/You accepted 40 meals from Hotel Sahyadri/)).toBeInTheDocument();
  });

  it('never accepts more than the offer or the remaining need', async () => {
    const user = userEvent.setup();
    const api = backend();
    restore = api.restore;
    renderWithProviders(<AcceptOfferDialog offer={offer} unit="MEALS" remaining={25} onClose={vi.fn()} />, { auth: authValue({ user: ngoOwner }) });
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(25);
    await user.clear(input);
    await user.type(input, '30');
    expect(screen.getByText('At most 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '2.5');
    expect(screen.getByText('Use a whole number')).toBeInTheDocument();
    await waitFor(() => expect(accepts(api.calls)).toHaveLength(0));
  });
});
