import { screen } from '@testing-library/react';
import { Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { NGO_NAV, visibleNavSections } from '@/layouts/navigation';
import { authValue, mockApi, ok, renderWithProviders } from '../../../tests/utils';
import { isNgoOwner, isRepresentativeOnly } from './access';
import NgoRoutes from './routes';
import { ngoOwner, representativeOnly } from './testing';

const labels = (user: typeof ngoOwner) => visibleNavSections(NGO_NAV, user).flatMap((s) => s.items.map((i) => i.label));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderNgo(route: string, user: typeof ngoOwner) {
  return renderWithProviders(
    <Suspense fallback={<p>loading page</p>}>
      <Routes>
        <Route
          path="/ngo/*"
          element={
            <>
              <Where />
              <NgoRoutes />
            </>
          }
        />
      </Routes>
    </Suspense>,
    { route, auth: authValue({ user }) },
  );
}

/** A tiny fake backend for the pages these tests open. */
function fakeBackend() {
  return mockApi((req) => {
    const page = { meta: { page: 1, pageSize: 5, total: 0, unread: 0 } };
    if (req.url === '/pickups') return ok([]);
    if (req.url === '/notifications') return ok([], page);
    if (req.url === '/analytics/ngo') return ok({ totals: {}, successfulCollectionRate: null, monthly: [], assistanceRequestsByStatus: {}, fees: { totalBilled: 0, outstanding: 0, thisMonth: 0 }, collectionPerformance: { averageMinutesAssignmentToHandover: null, sampleSize: 0 }, dataLabel: 'REAL' });
    if (req.url === '/billing/summary') return ok({ uninvoicedAmount: 0, outstandingInvoicedAmount: 0, paidAmount: 0, thisMonthAmount: 0, billedCollections: 0, billedQuantity: 0, currency: 'INR', feeRules: [], tax: { enabled: false, name: 'GST', ratePercent: 18 }, onlinePaymentsAvailable: false, notes: [] });
    if (req.url === '/billing/invoices' || req.url === '/billing/payments' || req.url === '/matching/donations') return ok([]);
    if (req.url === '/billing/history' || req.url === '/assistance-requests') return ok([], page);
    return { status: 404, data: { error: { code: 'NOT_FOUND', message: `unexpected ${req.method} ${req.url}` } } };
  });
}

describe('NGO user kinds', () => {
  it('tells owners and representative-only accounts apart', () => {
    expect(isNgoOwner(ngoOwner)).toBe(true);
    expect(isRepresentativeOnly(ngoOwner)).toBe(false);
    expect(isNgoOwner(representativeOnly)).toBe(false);
    expect(isRepresentativeOnly(representativeOnly)).toBe(true);
  });

  it('shows owners the whole NGO navigation', () => {
    const owner = labels(ngoOwner);
    expect(owner).toEqual(
      expect.arrayContaining(['Overview', 'Marketplace', 'My requests', 'Assistance requests', 'Collections', 'Pickups', 'Representatives', 'Route planning', 'Billing', 'Analytics', 'AI assistant', 'Notifications', 'Profile & settings']),
    );
    expect(owner).not.toContain('My pickups');
    expect(owner).not.toContain('Account');
  });

  it('limits representative-only accounts to their own work', () => {
    expect(labels(representativeOnly)).toEqual(['Overview', 'My pickups', 'AI assistant', 'Notifications', 'Account']);
  });
});

describe('NGO route gating', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it.each(['/ngo/marketplace', '/ngo/billing', '/ngo/assistance/new', '/ngo/representatives', '/ngo/planning/plan-1'])('sends a representative opening %s to the overview with an explanation', async (path) => {
    restore = fakeBackend().restore;
    renderNgo(path, representativeOnly);
    expect(await screen.findByText(/available to the NGO’s organisation account only/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/ngo$/);
    expect(screen.getByRole('heading', { name: 'Your active pickups' })).toBeInTheDocument();
  });

  it('lets a representative open their pickups', async () => {
    restore = fakeBackend().restore;
    renderNgo('/ngo/pickups', representativeOnly);
    expect(await screen.findByRole('heading', { name: 'My pickups' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/ngo/pickups');
  });

  it('lets the owner open owner-only pages', async () => {
    restore = fakeBackend().restore;
    renderNgo('/ngo/billing', ngoOwner);
    expect(await screen.findByRole('heading', { name: 'Billing', level: 1 }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/ngo/billing');
  });

  it('keeps unapproved owners out of approval-gated pages', async () => {
    restore = fakeBackend().restore;
    const pending = { ...ngoOwner, organization: { ...ngoOwner.organization!, verificationStatus: 'PENDING' as const } };
    renderNgo('/ngo/marketplace', pending);
    expect(await screen.findByText('The donation marketplace is available after verification', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
