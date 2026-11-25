import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { PickupDetail } from '@/types';
import { apiError, mockApi, ok, renderWithProviders } from '../../../tests/utils';
import { VerificationFlow } from './components/VerificationFlow';
import { deriveVerificationStep, qrRejectionCopy } from './verification';

function pickup(overrides: Partial<PickupDetail> = {}): PickupDetail {
  return {
    id: 'p1',
    allocationId: 'a1',
    status: 'ASSIGNED',
    viewer: 'DONOR',
    donation: { id: 'd1', foodName: 'Veg biryani', unit: 'MEALS', dietaryType: 'VEG', quantity: 50, pickupDeadline: '2099-01-01T00:00:00Z', address: 'Wakad, Pune', location: { lat: 18.6, lng: 73.76 } },
    donor: { id: 'dn1', name: 'Spice Garden' },
    ngo: { id: 'n1', name: 'Helping Hands Foundation' },
    representative: { id: 'r1', name: 'Asha Patil', phone: '+91******0102', idDocumentType: 'AADHAAR', idDocumentLast4: '0102', hasPhoto: false, status: 'ACTIVE' },
    scheduledPickupAt: null,
    destination: null,
    checks: { qrVerifiedAt: null, identityConfirmedAt: null },
    handedOverAt: null,
    deliveredAt: null,
    cancelReason: null,
    allocationStatus: 'PICKUP_ASSIGNED',
    createdAt: '2026-11-03T10:00:00Z',
    handover: null,
    delivery: null,
    trackingSessions: [],
    ...overrides,
  };
}

const T = '2026-11-03T10:05:00Z';

describe('deriveVerificationStep (handover step machine)', () => {
  it.each([
    ['no pickup yet', null, 'SCAN', undefined],
    ['QR not scanned', pickup(), 'SCAN', undefined],
    ['QR scanned, ID not checked', pickup({ checks: { qrVerifiedAt: T, identityConfirmedAt: null } }), 'IDENTITY', undefined],
    ['QR scanned en route, ID not checked', pickup({ status: 'EN_ROUTE', checks: { qrVerifiedAt: T, identityConfirmedAt: null } }), 'IDENTITY', undefined],
    ['verified, quantity not confirmed', pickup({ status: 'VERIFIED', checks: { qrVerifiedAt: T, identityConfirmedAt: T } }), 'HANDOVER', undefined],
    [
      'NGO confirmed first, donor still to confirm',
      pickup({ status: 'VERIFIED', handover: { status: 'PENDING_DONOR', donorConfirmedQuantity: null, ngoReceivedQuantity: 50, donorConfirmedAt: null, ngoConfirmedAt: T } }),
      'HANDOVER',
      undefined,
    ],
    [
      'donor confirmed, waiting for NGO',
      pickup({ status: 'VERIFIED', handover: { status: 'PENDING_NGO', donorConfirmedQuantity: 50, ngoReceivedQuantity: null, donorConfirmedAt: T, ngoConfirmedAt: null } }),
      'OUTCOME',
      'WAITING',
    ],
    [
      'both confirmed the same quantity',
      pickup({ status: 'HANDED_OVER', handover: { status: 'CONFIRMED', donorConfirmedQuantity: 50, ngoReceivedQuantity: 50, donorConfirmedAt: T, ngoConfirmedAt: T } }),
      'OUTCOME',
      'CONFIRMED',
    ],
    ['delivered', pickup({ status: 'DELIVERED' }), 'OUTCOME', 'CONFIRMED'],
    [
      'quantities differ',
      pickup({ status: 'DISPUTED', handover: { status: 'DISPUTED', donorConfirmedQuantity: 50, ngoReceivedQuantity: 40, donorConfirmedAt: T, ngoConfirmedAt: T } }),
      'OUTCOME',
      'DISPUTED',
    ],
    ['no-show reported', pickup({ status: 'FAILED' }), 'CLOSED', undefined],
    ['cancelled', pickup({ status: 'CANCELLED' }), 'CLOSED', undefined],
  ] as const)('%s → %s %s', (_label, p, step, outcome) => {
    expect(deriveVerificationStep(p)).toEqual(outcome ? { step, outcome } : { step });
  });

  it('has a clear message for every QR rejection reason', () => {
    for (const reason of ['TOKEN_EXPIRED', 'TOKEN_REVOKED', 'TOKEN_CONSUMED', 'WRONG_DONOR', 'REPRESENTATIVE_INACTIVE', 'TOKEN_NOT_FOUND', 'PICKUP_NOT_ACTIVE']) {
      expect(qrRejectionCopy(reason, 'x').title).not.toBe('The pass was rejected');
    }
    expect(qrRejectionCopy('WRONG_DONOR', 'x').stop).toBe(true);
    expect(qrRejectionCopy('SOMETHING_ELSE', 'Server says no').body).toBe('Server says no');
  });
});

describe('<VerificationFlow> against a fake backend', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('walks scan → ID check → quantity → waiting', async () => {
    const user = userEvent.setup();
    let server = pickup();
    const api = mockApi((req) => {
      if (req.method === 'POST' && req.url === '/pickups/verify-qr') {
        const token = (req.body as { token: string }).token;
        if (token !== 'FBP1.good-token') return apiError(422, 'QR_REJECTED', 'This pickup pass has expired. Ask the representative to generate a new one.', { reason: 'TOKEN_EXPIRED' });
        server = pickup({ checks: { qrVerifiedAt: T, identityConfirmedAt: null } });
        return ok({ pickup: server });
      }
      if (req.method === 'GET' && req.url === '/pickups/p1') return ok(server);
      if (req.method === 'POST' && req.url === '/pickups/confirm-identity') {
        server = { ...server, status: 'VERIFIED', checks: { ...server.checks, identityConfirmedAt: T } };
        return ok(server);
      }
      if (req.method === 'POST' && req.url === '/pickups/confirm-handover') {
        const q = (req.body as { quantity: number }).quantity;
        server = { ...server, handover: { status: 'PENDING_NGO', donorConfirmedQuantity: q, ngoReceivedQuantity: null, donorConfirmedAt: T, ngoConfirmedAt: null } };
        return ok({ outcome: 'WAITING', pickup: server });
      }
      return apiError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.url}`);
    });
    restore = api.restore;

    renderWithProviders(<VerificationFlow />);

    // 1. A rejected pass shows the specific reason.
    await user.type(screen.getByLabelText(/pass code/i), 'FBP1.old-token');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByText('This pass has expired')).toBeInTheDocument();

    // 2. A valid pass goes straight to the ID check, showing the representative to compare.
    await user.clear(screen.getByLabelText(/pass code/i));
    await user.type(screen.getByLabelText(/pass code/i), 'FBP1.good-token');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByText('QR pass verified')).toBeInTheDocument();
    expect(screen.getByText('Asha Patil')).toBeInTheDocument();
    expect(screen.getByText('0102', { selector: 'span' })).toBeInTheDocument();

    // 3. Physical ID check is required before confirming identity.
    const confirmIdentity = screen.getByRole('button', { name: 'Confirm identity' });
    expect(confirmIdentity).toBeDisabled();
    await user.click(screen.getByLabelText(/I checked the representative’s physical ID/));
    await user.click(confirmIdentity);

    // 4. Quantity is limited to what was reserved.
    const qty = await screen.findByLabelText(/Quantity handed over/);
    await user.clear(qty);
    await user.type(qty, '60');
    expect(screen.getByRole('button', { name: 'Confirm handover' })).toBeDisabled();
    await user.clear(qty);
    await user.type(qty, '48');
    await user.click(screen.getByRole('button', { name: 'Confirm handover' }));

    expect(await screen.findByText('Waiting for the NGO to confirm')).toBeInTheDocument();
    const handover = api.calls.find((c) => c.url === '/pickups/confirm-handover');
    expect(handover?.body).toEqual({ pickupId: 'p1', quantity: 48 });
    // The flow is exactly pass → identity → handover: no other verification calls.
    expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/pickups/verify-qr', '/pickups/verify-qr', '/pickups/confirm-identity', '/pickups/confirm-handover']);
  });

  it('explains a disputed handover (no points or fees)', async () => {
    const disputed = pickup({ status: 'DISPUTED', handover: { status: 'DISPUTED', donorConfirmedQuantity: 50, ngoReceivedQuantity: 45, donorConfirmedAt: T, ngoConfirmedAt: T } });
    const api = mockApi((req) => (req.url === '/pickups/p1' ? ok(disputed) : apiError(404, 'NOT_FOUND', 'Not found.')));
    restore = api.restore;
    renderWithProviders(<VerificationFlow pickupId="p1" />);
    expect(await screen.findByText('Quantities do not match: FoodBridge will review')).toBeInTheDocument();
    expect(screen.getByText(/No reward points or service fees are recorded/)).toBeInTheDocument();
  });

  it('shows a stop warning when the pass belongs to another donor', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(422, 'QR_REJECTED', 'This pickup pass is for a different donor. Do not hand over food.', { reason: 'WRONG_DONOR' }));
    restore = api.restore;
    renderWithProviders(<VerificationFlow />);
    await user.type(screen.getByLabelText(/pass code/i), 'FBP1.someone-else');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByText('This pass is for a different donor')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Do not hand over food.')).toBeInTheDocument());
  });
});
