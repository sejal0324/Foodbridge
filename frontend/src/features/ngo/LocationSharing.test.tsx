import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authValue, mockApi, ok, renderWithProviders, type FakeRequest } from '../../../tests/utils';
import { LocationSharingCard } from './components/LocationSharingCard';
import { ngoOwner, pickup, sessionView } from './testing';
import { shouldSend } from './tracking/useLocationSharing';

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;

/** A controllable navigator.geolocation. */
function fakeGeolocation() {
  const handlers: { success?: Success; error?: Failure; options?: PositionOptions } = {};
  const geo = {
    watchPosition: vi.fn((success: Success, error: Failure, options: PositionOptions) => {
      Object.assign(handlers, { success, error, options });
      return 7;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  return { geo, handlers };
}

const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);
function position(lat: number, lng: number, ms: number, extra: Partial<GeolocationCoordinates> = {}): GeolocationPosition {
  return { timestamp: T0 + ms, coords: { latitude: lat, longitude: lng, accuracy: 12, altitude: null, altitudeAccuracy: null, heading: 90, speed: 4.2, ...extra } } as unknown as GeolocationPosition;
}
// ~0.00027° of latitude ≈ 30 m.
const BASE = { lat: 18.5886, lng: 73.7313 };

function backend() {
  return mockApi((req: FakeRequest) => {
    if (req.url === '/tracking/start') return { status: 201, data: { data: sessionView('session-1') } };
    if (req.url === '/tracking/location') return ok({ accepted: true, session: sessionView('session-1', { liveness: 'LIVE' }) });
    if (req.url === '/tracking/events') return ok({ recorded: true });
    if (req.url === '/tracking/stop') return ok(sessionView('session-1', { status: 'ENDED', liveness: 'ENDED' }));
    return { status: 404, data: { error: { code: 'NOT_FOUND', message: 'unexpected' } } };
  });
}

const posts = (calls: FakeRequest[], url: string) => calls.filter((c) => c.method === 'POST' && c.url === url);

async function startSharing(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Start sharing my location' }));
  const consent = screen.getByRole('dialog', { name: 'Share your location for this trip?' });
  // The consent dialog explains what is shared, with whom and for how long.
  expect(within(consent).getByText('What is shared')).toBeInTheDocument();
  expect(within(consent).getByText(/Spice Garden Restaurant \(only for this trip to the pickup\)/)).toBeInTheDocument();
  expect(within(consent).getByText('For how long')).toBeInTheDocument();
  await user.click(within(consent).getByRole('button', { name: 'I agree, start sharing' }));
}

describe('LiveTrack throttle rule', () => {
  it('sends the first position, then every 10 s or after 25 m', () => {
    const at = (ms: number, dLat = 0) => ({ lat: BASE.lat + dLat, lng: BASE.lng, time: T0 + ms });
    expect(shouldSend(null, at(0))).toBe(true);
    expect(shouldSend(at(0), at(3_000))).toBe(false);
    expect(shouldSend(at(0), at(9_999, 0.0001))).toBe(false); // ~11 m
    expect(shouldSend(at(0), at(4_000, 0.00027))).toBe(true); // ~30 m
    expect(shouldSend(at(0), at(10_000))).toBe(true);
  });
});

describe('<LocationSharingCard>', () => {
  let restore: () => void = () => undefined;
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  afterEach(() => {
    restore();
    if (original) Object.defineProperty(navigator, 'geolocation', original);
    else delete (navigator as { geolocation?: unknown }).geolocation;
  });

  it('asks for consent, starts a session and throttles position uploads', async () => {
    const user = userEvent.setup();
    const { geo, handlers } = fakeGeolocation();
    const api = backend();
    restore = api.restore;
    const view = renderWithProviders(<LocationSharingCard pickup={pickup} stage="TO_PICKUP" />, { auth: authValue({ user: ngoOwner }) });
    expect(screen.getByText(/Only works while this page is open in the foreground/)).toBeInTheDocument();
    expect(screen.getByText(/Arriving at the location does not complete anything/)).toBeInTheDocument();

    await startSharing(user);
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalledTimes(1));
    expect(posts(api.calls, '/tracking/start').map((c) => c.body)).toEqual([{ pickupId: pickup.id, stage: 'TO_PICKUP', consent: true }]);
    expect(handlers.options).toMatchObject({ enableHighAccuracy: true });

    const emit = async (p: GeolocationPosition) => {
      await act(async () => handlers.success?.(p));
    };
    await emit(position(BASE.lat, BASE.lng, 0));
    await waitFor(() => expect(posts(api.calls, '/tracking/location')).toHaveLength(1));
    expect(posts(api.calls, '/tracking/location')[0]?.body).toEqual({ sessionId: 'session-1', lat: BASE.lat, lng: BASE.lng, recordedAt: new Date(T0).toISOString(), accuracyM: 12, heading: 90, speedMps: 4.2 });
    expect(await screen.findByText('Sharing location')).toBeInTheDocument();
    expect(screen.getByText(/Last sent at/)).toHaveTextContent('±12 m');

    await emit(position(BASE.lat, BASE.lng, 3_000)); // too soon, did not move
    await emit(position(BASE.lat + 0.0001, BASE.lng, 6_000)); // ~11 m: still too soon
    expect(posts(api.calls, '/tracking/location')).toHaveLength(1);

    await emit(position(BASE.lat + 0.0004, BASE.lng, 7_000)); // moved ~44 m from the last upload
    await waitFor(() => expect(posts(api.calls, '/tracking/location')).toHaveLength(2));

    await emit(position(BASE.lat + 0.0004, BASE.lng, 12_000)); // 5 s later, same place
    expect(posts(api.calls, '/tracking/location')).toHaveLength(2);
    await emit(position(BASE.lat + 0.0004, BASE.lng, 17_100, { heading: null, speed: null })); // 10.1 s later
    await waitFor(() => expect(posts(api.calls, '/tracking/location')).toHaveLength(3));
    expect(posts(api.calls, '/tracking/location')[2]?.body).not.toHaveProperty('heading');

    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(posts(api.calls, '/tracking/stop').map((c) => c.body)).toEqual([{ sessionId: 'session-1', reason: 'stopped by the representative' }]));
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    view.unmount();
  });

  it('records PERMISSION_DENIED, stops watching and explains the limitation', async () => {
    const user = userEvent.setup();
    const { geo, handlers } = fakeGeolocation();
    const api = backend();
    restore = api.restore;
    renderWithProviders(<LocationSharingCard pickup={pickup} stage="TO_PICKUP" />, { auth: authValue({ user: ngoOwner }) });
    await startSharing(user);
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());

    await act(async () => handlers.error?.({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError));

    expect(await screen.findByText('Location permission was denied')).toBeInTheDocument();
    expect(screen.getByText(/You can still collect: the donor verifies your pass and photo ID/)).toBeInTheDocument();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    await waitFor(() => expect(posts(api.calls, '/tracking/events').map((c) => c.body)).toEqual([{ sessionId: 'session-1', type: 'PERMISSION_DENIED', detail: 'User denied Geolocation' }]));
    // The empty session is ended so viewers are not left waiting for positions.
    await waitFor(() => expect(posts(api.calls, '/tracking/stop').map((c) => c.body)).toEqual([{ sessionId: 'session-1', reason: 'location permission denied' }]));
    expect(posts(api.calls, '/tracking/location')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reports an unavailable position once and keeps waiting', async () => {
    const user = userEvent.setup();
    const { handlers } = fakeGeolocation();
    const api = backend();
    restore = api.restore;
    renderWithProviders(<LocationSharingCard pickup={pickup} stage="TO_PICKUP" />, { auth: authValue({ user: ngoOwner }) });
    await startSharing(user);
    await waitFor(() => expect(handlers.error).toBeDefined());
    const unavailable = { code: 2, message: 'Position unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
    await act(async () => handlers.error?.(unavailable));
    await act(async () => handlers.error?.(unavailable));
    expect(await screen.findByText(/cannot determine its position right now/)).toBeInTheDocument();
    await waitFor(() => expect(posts(api.calls, '/tracking/events').map((c) => (c.body as { type: string }).type)).toEqual(['POSITION_UNAVAILABLE']));
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument();
  });

  it('explains when the browser has no geolocation at all', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    const api = backend();
    restore = api.restore;
    renderWithProviders(<LocationSharingCard pickup={pickup} stage="TO_PICKUP" />, { auth: authValue({ user: ngoOwner }) });
    await startSharing(user);
    expect(await screen.findByText('Location sharing is not available in this browser')).toBeInTheDocument();
    await waitFor(() => expect(posts(api.calls, '/tracking/events').map((c) => c.body)).toEqual([{ pickupId: pickup.id, type: 'POSITION_UNAVAILABLE', detail: 'This browser has no geolocation support' }]));
    expect(posts(api.calls, '/tracking/start')).toHaveLength(0);
  });
});
