import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoSearchResult } from '@/types';
import { apiError, mockApi, ok, renderWithProviders } from '../../../tests/utils';
import { addressLineFrom, fillEmptyAddressFields } from './geo';
import { LocationPicker } from './LocationPicker';

vi.mock('./MapView', () => ({
  MapView: ({ onPick }: { onPick?: (p: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onPick?.({ lat: 12.9716, lng: 77.5946 })}>
      fake map
    </button>
  ),
}));

const wakad: GeoSearchResult = { label: 'Wakad Main Road, Wakad, Pimpri-Chinchwad, Maharashtra 411057, India', lat: 18.5987, lng: 73.7645, city: 'Pimpri-Chinchwad', state: 'Maharashtra', postalCode: '411057' };
const chennai: GeoSearchResult = { label: 'Anna Salai, Chennai, Tamil Nadu, India', lat: 13.0604, lng: 80.2496, city: 'Chennai', state: 'Tamil Nadu', postalCode: null };

describe('address helpers', () => {
  it('keeps the street part of a geocoder label', () => {
    expect(addressLineFrom(wakad)).toBe('Wakad Main Road, Wakad');
    expect(addressLineFrom(chennai)).toBe('Anna Salai');
    expect(
      addressLineFrom({ label: 'Wakad, Tathawade, Mulshi Subdistrict, Pune District, Maharashtra, 411071, India', lat: 18.6, lng: 73.76, city: 'Tathawade', state: 'Maharashtra', postalCode: '411071' }),
    ).toBe('Wakad');
  });

  it('pre-fills only the empty address fields', () => {
    const values: Record<string, string> = { addressLine: '', city: 'Pune', state: '', postalCode: '' };
    fillEmptyAddressFields(wakad, { get: (f) => values[f], set: (f, v) => (values[f] = v) });
    expect(values).toEqual({ addressLine: 'Wakad Main Road, Wakad', city: 'Pune', state: 'Maharashtra', postalCode: '411057' });
  });

  it('skips a state it cannot match to the official list', () => {
    const values: Record<string, string> = { addressLine: 'x', city: 'y', state: '', postalCode: 'z' };
    fillEmptyAddressFields({ ...chennai, state: 'Unknown Province' }, { get: (f) => values[f], set: (f, v) => (values[f] = v) });
    expect(values.state).toBe('');
  });
});

describe('<LocationPicker> address search', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('searches after 3 characters (debounced), lists results, and selecting moves the marker and reports the address', async () => {
    const user = userEvent.setup();
    const api = mockApi((req) => (req.url === '/geo/search' ? ok({ provider: 'OPENSTREETMAP', results: [wakad, chennai] }) : apiError(404, 'NOT_FOUND', 'x')));
    restore = api.restore;
    const onChange = vi.fn();
    const onAddressSelect = vi.fn();
    renderWithProviders(<LocationPicker value={null} onChange={onChange} onAddressSelect={onAddressSelect} />);

    const box = screen.getByRole('combobox', { name: /search for an address in india/i });
    await user.type(box, 'Wa');
    await new Promise((r) => setTimeout(r, 600));
    expect(api.calls).toHaveLength(0);

    await user.type(box, 'kad');
    const option = await screen.findByRole('option', { name: /Wakad Main Road/ }, { timeout: 2000 });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.params).toEqual({ q: 'Wakad' });
    expect(screen.getByText('Search © OpenStreetMap contributors')).toBeInTheDocument();

    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ lat: 18.5987, lng: 73.7645 });
    expect(onAddressSelect).toHaveBeenCalledWith(wakad);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    // The chosen label is not searched again, and the OSM notice stays visible.
    await new Promise((r) => setTimeout(r, 600));
    expect(api.calls).toHaveLength(1);
    expect(screen.getByText('Search © OpenStreetMap contributors')).toBeInTheDocument();
  });

  it('does not show the OpenStreetMap notice for Google results, and Enter never submits the surrounding form', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ok({ provider: 'GOOGLE', results: [chennai] }));
    restore = api.restore;
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const onChange = vi.fn();
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <LocationPicker value={null} onChange={onChange} />
      </form>,
    );
    await user.type(screen.getByRole('combobox'), 'Anna Salai');
    await screen.findByRole('option', { name: /Anna Salai/ }, { timeout: 2000 });
    expect(screen.queryByText('Search © OpenStreetMap contributors')).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ lat: 13.0604, lng: 80.2496 });
  });

  it('explains when the search is rate-limited', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
    restore = api.restore;
    renderWithProviders(<LocationPicker value={null} onChange={vi.fn()} />);
    await user.type(screen.getByRole('combobox'), 'Kolkata');
    expect(await screen.findByText(/Too many searches/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it('still supports clicking the map and the current-location button (denial handled)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const getCurrentPosition = vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
      fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' } as GeolocationPositionError),
    );
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    renderWithProviders(<LocationPicker value={null} onChange={onChange} />);
    expect(getCurrentPosition).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'fake map' }));
    expect(onChange).toHaveBeenCalledWith({ lat: 12.9716, lng: 77.5946 });

    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission was denied/));
  });
});
