import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, mockApi, ok, renderWithProviders } from '../../../tests/utils';
import { PickupPassCard } from './components/PickupPassCard';
import { ngoOwner, pickup } from './testing';

const T0 = new Date('2026-11-03T12:00:00.000Z').getTime();

describe('representative pickup pass', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    // Only the clock and intervals are faked (the countdown), so promises and user events run normally.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: T0 });
  });
  afterEach(() => {
    restore();
    vi.useRealTimers();
  });

  it('shows the QR, a live expiry countdown and the code for manual entry', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ok({ pickupId: pickup.id, token: 'FBP1.first-token', qrPayload: 'FBP1.first-token', expiresAt: new Date(T0 + 5 * 60_000).toISOString(), ttlMinutes: 5 }));
    restore = api.restore;
    renderWithProviders(<PickupPassCard pickup={pickup} />, { auth: authValue({ user: ngoOwner }) });

    await user.click(screen.getByRole('button', { name: 'Generate pass' }));
    expect(await screen.findByRole('img', { name: /Pickup pass for Veg biryani/ })).toBeInTheDocument();
    expect(screen.getByText('FBP1.first-token')).toBeInTheDocument();
    expect(screen.getByTestId('pass-countdown')).toHaveTextContent('05:00');
    expect(api.calls.map((c) => [c.method, c.url, c.body])).toEqual([['POST', '/pickups/generate-pass', { pickupId: pickup.id }]]);

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId('pass-countdown')).toHaveTextContent('03:59');

    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(screen.getByText('This pass has expired')).toBeInTheDocument();
    expect(screen.queryByTestId('pass-countdown')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate a new pass' })).toBeInTheDocument();
  });

  it('regenerates after explaining that the old pass is revoked', async () => {
    const user = userEvent.setup();
    let n = 0;
    const api = mockApi(() => {
      n += 1;
      return ok({ pickupId: pickup.id, token: `FBP1.token-${n}`, qrPayload: `FBP1.token-${n}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), ttlMinutes: 10 });
    });
    restore = api.restore;
    renderWithProviders(<PickupPassCard pickup={pickup} />, { auth: authValue({ user: ngoOwner }) });
    await user.click(screen.getByRole('button', { name: 'Generate pass' }));
    expect(await screen.findByText('FBP1.token-1')).toBeInTheDocument();
    expect(screen.getByText(/A new pass immediately revokes the previous one/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Regenerate pass' }));
    const dialog = screen.getByRole('dialog', { name: 'Replace this pass?' });
    expect(within(dialog).getByText(/current pass stops working immediately/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Generate new pass' }));

    expect(await screen.findByText('FBP1.token-2')).toBeInTheDocument();
    expect(screen.queryByText('FBP1.token-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('pass-countdown')).toHaveTextContent('10:00');
    expect(api.calls).toHaveLength(2);
  });

  it('switches to the verification progress once the donor has scanned the pass', () => {
    renderWithProviders(<PickupPassCard pickup={{ ...pickup, checks: { qrVerifiedAt: new Date(T0).toISOString(), identityConfirmedAt: null } }} />, { auth: authValue({ user: ngoOwner }) });
    expect(screen.getByText(/The donor scanned your pass/)).toBeInTheDocument();
    expect(screen.getByText('Now show the photo ID you registered with your NGO.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate pass' })).not.toBeInTheDocument();
  });
});
