import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, authValue, mockApi, ok, renderWithProviders, type FakeReply, type FakeRequest } from '../../../tests/utils';
import AssistanceCreatePage from './pages/AssistanceCreatePage';
import { ngoOwner } from './testing';

// Leaflet is not needed here: a stub picker reports the chosen point as text.
vi.mock('@/components/map', () => ({
  LocationPicker: ({ value, fallback }: { value: { lat: number; lng: number } | null; fallback?: { title: string } | null }) => (
    <p data-testid="picker">{value ? `${value.lat},${value.lng}` : `none (${fallback?.title ?? 'no fallback'})`}</p>
  ),
  addressLineFrom: () => 'Somewhere',
}));

const profile = {
  id: 'ngo-1',
  organizationName: 'Helping Hands Foundation',
  addressLine: 'Phase 2, Hinjewadi',
  city: 'Pune',
  location: { lat: 18.5886, lng: 73.7313 },
  beneficiariesCount: 180,
  foodPreferences: [],
};

function backend(onCreate: (req: FakeRequest) => FakeReply) {
  return mockApi((req) => {
    if (req.url === '/ngos/me') return ok(profile);
    if (req.url === '/food-categories') return ok([{ id: '5b2f0c4e-3a8e-4b8e-9a51-6a3a2f1f2c11', code: 'COOKED_MEALS', name: 'Cooked meals', description: null, reviewFlagHoursAfterPreparation: 4, requiresRefrigeration: false }]);
    if (req.method === 'POST' && req.url === '/assistance-requests') return onCreate(req);
    return { status: 404, data: { error: { code: 'NOT_FOUND', message: 'unexpected' } } };
  });
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/ngo/assistance/new" element={<AssistanceCreatePage />} />
      <Route path="/ngo/assistance/:id" element={<p>detail page</p>} />
    </Routes>,
    { route: '/ngo/assistance/new', auth: authValue({ user: ngoOwner }) },
  );
}

const creates = (calls: FakeRequest[]) => calls.filter((c) => c.method === 'POST' && c.url === '/assistance-requests');

describe('assistance request form', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('validates on the client before anything is sent', async () => {
    const user = userEvent.setup();
    const api = backend(() => ok({ id: 'x' }));
    restore = api.restore;
    renderPage();
    const quantity = await screen.findByRole('spinbutton', { name: /^Quantity/ });
    // Defaults come from the NGO profile (location, address, people served).
    expect(screen.getByTestId('picker')).toHaveTextContent('18.5886,73.7313');
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('Phase 2, Hinjewadi, Pune');
    expect(screen.getByRole('spinbutton', { name: /People it will feed/ })).toHaveValue(180);

    const from = screen.getByLabelText(/Needed from/);
    const until = screen.getByLabelText(/Needed until/);
    fireEvent.change(until, { target: { value: (from as HTMLInputElement).value.replace(/T\d\d:\d\d$/, 'T09:00') } });
    await user.click(screen.getByRole('button', { name: 'Publish request' }));
    expect(await screen.findByText('Choose a food category')).toBeInTheDocument();
    expect(screen.getByText('Must be after the start time')).toBeInTheDocument();

    await user.clear(quantity);
    await user.type(quantity, '2.5');
    await user.click(screen.getByRole('button', { name: 'Publish request' }));
    expect(await screen.findByText('Use a whole number')).toBeInTheDocument();
    expect(creates(api.calls)).toHaveLength(0);
  });

  it('maps a 422 from the server onto the fields and sends an Idempotency-Key', async () => {
    const user = userEvent.setup();
    const api = backend(() =>
      apiError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', [
        { path: 'beneficiariesCount', message: 'Too many people for this request' },
        { path: 'location.lat', message: 'Latitude is invalid' },
      ]),
    );
    restore = api.restore;
    renderPage();
    await screen.findByRole('option', { name: 'Cooked meals' });
    await user.selectOptions(screen.getByRole('combobox', { name: /Food category/ }), 'Cooked meals');
    await user.click(screen.getByRole('button', { name: 'Publish request' }));

    expect(await screen.findByText('Too many people for this request')).toBeInTheDocument();
    expect(screen.getByText('Latitude is invalid')).toBeInTheDocument();
    const [req] = creates(api.calls);
    expect(req?.headers.get('Idempotency-Key')).toMatch(/.{8,}/);
    expect(req?.body).toMatchObject({ categoryId: '5b2f0c4e-3a8e-4b8e-9a51-6a3a2f1f2c11', dietaryRequirement: 'VEG_ONLY', quantityRequired: 100, unit: 'MEALS', urgency: 'MEDIUM', beneficiariesCount: 180, location: { lat: 18.5886, lng: 73.7313 }, address: 'Phase 2, Hinjewadi, Pune' });
    expect((req?.body as { neededFrom: string }).neededFrom).toMatch(/T12:00:00\+05:30$/);
  });

  it('puts business errors on the right field and opens the new request on success', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = backend(() => (++attempt === 1 ? apiError(422, 'LOCATION_OUTSIDE_INDIA', 'FoodBridge currently operates only within India. Choose a location in India.') : { status: 201, data: { data: { id: 'ar-99' } } }));
    restore = api.restore;
    renderPage();
    await screen.findByRole('option', { name: 'Cooked meals' });
    await user.selectOptions(screen.getByRole('combobox', { name: /Food category/ }), 'Cooked meals');
    await user.click(screen.getByRole('button', { name: 'Publish request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a location in India');

    await user.click(screen.getByRole('button', { name: 'Publish request' }));
    expect(await screen.findByText('detail page')).toBeInTheDocument();
    const keys = creates(api.calls).map((c) => c.headers.get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    // One key per submit attempt.
    await waitFor(() => expect(keys[0]).not.toEqual(keys[1]));
  });
});
