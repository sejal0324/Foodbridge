import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderWithProviders } from '../../../../tests/utils';
import { disputeResolveSchema, toDisputeResolveBody } from '../schemas';
import type { Dispute } from '../types';
import { DisputeResolveDialog } from './DisputeResolveDialog';

const dispute: Dispute = {
  id: '5f0b1c2d-0000-4000-8000-000000000001',
  type: 'QUANTITY_MISMATCH',
  status: 'OPEN',
  description: null,
  resolution: null,
  resolvedQuantity: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  resolvedAt: null,
  allocationId: 'a1',
  pickupId: null,
  foodName: 'Veg biryani',
  unit: 'MEALS',
  donorName: 'Spice Garden',
  ngoName: 'Helping Hands',
  donorQuantity: 40,
  ngoQuantity: 35,
  allocatedQuantity: 40,
};

describe('dispute resolution', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('schema: CONFIRM_QUANTITY needs a whole quantity from 1 to the allocated quantity', () => {
    const schema = disputeResolveSchema(40);
    const base = { outcome: 'CONFIRM_QUANTITY' as const, resolution: 'Agreed on the phone' };
    expect(schema.safeParse({ ...base, resolvedQuantity: '' }).success).toBe(false);
    expect(schema.safeParse({ ...base, resolvedQuantity: '0' }).success).toBe(false);
    expect(schema.safeParse({ ...base, resolvedQuantity: '41' }).success).toBe(false);
    expect(schema.safeParse({ ...base, resolvedQuantity: '12.5' }).success).toBe(false);
    expect(schema.safeParse({ ...base, resolvedQuantity: '40' }).success).toBe(true);
    expect(schema.safeParse({ ...base, resolvedQuantity: '1' }).success).toBe(true);
    // CANCEL ignores the quantity entirely.
    expect(schema.safeParse({ outcome: 'CANCEL_COLLECTION', resolvedQuantity: '', resolution: 'Food spoiled' }).success).toBe(true);
    expect(schema.safeParse({ outcome: 'CANCEL_COLLECTION', resolvedQuantity: '', resolution: 'x' }).success).toBe(false);
  });

  it('mapper: includes resolvedQuantity only for CONFIRM_QUANTITY', () => {
    expect(toDisputeResolveBody({ outcome: 'CONFIRM_QUANTITY', resolvedQuantity: ' 35 ', resolution: ' ok ' })).toEqual({ outcome: 'CONFIRM_QUANTITY', resolvedQuantity: 35, resolution: 'ok' });
    const cancel = toDisputeResolveBody({ outcome: 'CANCEL_COLLECTION', resolvedQuantity: '35', resolution: 'Food spoiled' });
    expect(cancel).toEqual({ outcome: 'CANCEL_COLLECTION', resolution: 'Food spoiled' });
    expect(cancel).not.toHaveProperty('resolvedQuantity');
  });

  it('requires and bounds the quantity when confirming, then sends it', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 204 }));
    restore = api.restore;
    const onClose = vi.fn();
    renderWithProviders(<DisputeResolveDialog dispute={dispute} unit="MEALS" onClose={onClose} />);

    expect(screen.getByText(/points and the NGO’s service fee are then recorded from this quantity/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Resolution/), 'Both agreed 35 meals on a call');
    await user.click(screen.getByRole('button', { name: 'Confirm quantity' }));
    expect(await screen.findByText(/Enter the quantity both sides should be recorded/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Confirmed quantity/), '41');
    await user.click(screen.getByRole('button', { name: 'Confirm quantity' }));
    expect(await screen.findByText(/Enter a quantity from 1 to 40/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Use NGO’s figure (35)' }));
    await user.click(screen.getByRole('button', { name: 'Confirm quantity' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PATCH /admin/disputes/${dispute.id}/resolve`]);
    expect(api.calls[0]?.body).toEqual({ outcome: 'CONFIRM_QUANTITY', resolvedQuantity: 35, resolution: 'Both agreed 35 meals on a call' });
  });

  it('cancels the collection without a quantity (no points, no fee)', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 204 }));
    restore = api.restore;
    renderWithProviders(<DisputeResolveDialog dispute={dispute} unit="MEALS" onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Confirmed quantity/), '30');
    await user.click(screen.getByLabelText(/Cancel the collection/));
    expect(screen.queryByLabelText(/Confirmed quantity/)).not.toBeInTheDocument();
    expect(screen.getByText(/No reward points are credited and no service fee is charged/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Resolution/), 'Food was spoiled on arrival');
    await user.click(screen.getByRole('button', { name: 'Cancel collection' }));
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]?.body).toEqual({ outcome: 'CANCEL_COLLECTION', resolution: 'Food was spoiled on arrival' });
  });
});
