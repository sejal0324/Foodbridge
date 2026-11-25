import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, renderWithProviders } from '../../../tests/utils';
import { PendingActionCard } from './components/PendingActionCard';
import { resolveAssistantLink } from './links';

const payload = { categoryCode: 'COOKED_MEALS', quantityRequired: 100, unit: 'MEALS', urgency: 'HIGH' };

describe('assistant pending action', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('does nothing until the user confirms, then calls the confirm endpoint', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 201, data: { data: { id: 'req-1' } } }));
    restore = api.restore;
    const onStatusChange = vi.fn();
    renderWithProviders(<PendingActionCard actionId={42} summary="Create an assistance request for 100 meals" payload={payload} status="PENDING" expiresInMinutes={30} onStatusChange={onStatusChange} />);

    expect(api.calls).toHaveLength(0);
    expect(screen.getByText('Create an assistance request for 100 meals')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Done: the request was created.')).toBeInTheDocument();
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /ai/actions/42/confirm']);
    expect(onStatusChange).toHaveBeenCalledWith('CONFIRMED');
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('cancels without creating anything', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 204 }));
    restore = api.restore;
    renderWithProviders(<PendingActionCard actionId={7} summary="Draft" payload={payload} status="PENDING" />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Nothing was changed.')).toBeInTheDocument();
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /ai/actions/7/cancel']);
  });

  it('shows the server message when the action expired', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(409, 'ACTION_EXPIRED', 'This pending action has expired. Ask the assistant again.'));
    restore = api.restore;
    renderWithProviders(<PendingActionCard actionId={9} summary="Draft" payload={payload} status="PENDING" />);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('This pending action has expired. Ask the assistant again.')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('maps role-neutral card links into the current area', () => {
    expect(resolveAssistantLink('/donations', 'DONOR')).toBe('/donor/donations');
    expect(resolveAssistantLink('/pickups', 'NGO')).toBe('/ngo/pickups');
    expect(resolveAssistantLink('/donor/rewards', 'DONOR')).toBe('/donor/rewards');
    expect(resolveAssistantLink('/admin/ai', 'DONOR')).toBeNull();
    expect(resolveAssistantLink('//evil.example', 'DONOR')).toBeNull();
  });
});
