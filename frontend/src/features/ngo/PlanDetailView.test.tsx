import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MapMarker } from '@/components/map';
import { authValue, renderWithProviders } from '../../../tests/utils';
import { PlanDetailView } from './components/PlanDetailView';
import { ngoOwner } from './testing';
import type { CollectionPlan, PlanStop } from './types';

vi.mock('@/components/map', () => ({
  MapView: ({ markers = [], path = [] }: { markers?: MapMarker[]; path?: unknown[] }) => (
    <div data-testid="map">
      markers:{markers.map((m) => m.label).join(',')} path:{path.length}
    </div>
  ),
}));

const stop = (over: Partial<PlanStop>): PlanStop => ({
  id: 's',
  sequence: null,
  type: 'PICKUP',
  allocationId: 'a',
  location: { lat: 18.6, lng: 73.76 },
  address: 'Wakad Main Road, Pune',
  windowStart: '2026-11-03T11:00:00.000Z',
  windowEnd: '2026-11-03T16:00:00.000Z',
  plannedArrivalAt: null,
  quantity: 50,
  status: 'PENDING',
  dropReason: null,
  foodName: 'Veg biryani',
  donorName: 'Spice Garden Restaurant',
  ...over,
});

const plan: CollectionPlan = {
  id: 'plan-1',
  planDate: '2026-11-03',
  representativeId: null,
  vehicleCapacity: 100,
  start: { location: { lat: 18.5886, lng: 73.7313 }, address: 'Phase 2, Hinjewadi' },
  end: { location: { lat: 18.5886, lng: 73.7313 }, address: 'Phase 2, Hinjewadi' },
  startTime: '2026-11-03T12:30:00.000Z',
  status: 'DRAFT',
  solver: 'OR_TOOLS',
  solverStatus: 'PARTIAL',
  distanceSource: 'STRAIGHT_LINE_ESTIMATE',
  totalDistanceM: 12_400,
  totalDurationS: 3_300,
  explanation: 'Visits 2 of 3 stops within the vehicle capacity.',
  infeasibilityReasons: ['Stop Annapurna Caterers exceeds the remaining vehicle capacity (80 > 50).'],
  createdAt: '2026-11-03T12:00:00.000Z',
  stops: [
    stop({ id: 'b', sequence: 2, foodName: 'Paneer curry', donorName: 'Hotel Sahyadri', plannedArrivalAt: '2026-11-03T13:10:00.000Z', location: { lat: 18.559, lng: 73.7868 } }),
    stop({ id: 'a', sequence: 1, plannedArrivalAt: '2026-11-03T12:45:00.000Z' }),
    stop({ id: 'c', sequence: null, status: 'DROPPED', dropReason: 'Exceeds the remaining vehicle capacity', foodName: 'Dal thali', donorName: 'Annapurna Caterers', quantity: 80 }),
    stop({ id: 'end', type: 'DROP_OFF', sequence: 4, allocationId: null, quantity: 0, plannedArrivalAt: '2026-11-03T13:25:00.000Z', foodName: null, donorName: null }),
  ],
};

describe('<PlanDetailView>', () => {
  it('numbers the route in sequence and shows dropped stops with their reason', () => {
    renderWithProviders(<PlanDetailView plan={plan} />, { auth: authValue({ user: ngoOwner }) });
    // Start, stops 1 and 2 in sequence, the dropped stop unnumbered; the end equals the start.
    expect(screen.getByTestId('map')).toHaveTextContent('markers:S,1,2,– path:4');
    const table = screen.getByRole('table', { name: 'Collection stops' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['1', '2', '–']);
    expect(within(rows[0] as HTMLElement).getByText('Spice Garden Restaurant')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Dropped')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Exceeds the remaining vehicle capacity')).toBeInTheDocument();
    expect(screen.getByText('Partial route')).toBeInTheDocument();
    expect(screen.getByText(/2 planned · 1 dropped/)).toBeInTheDocument();
    expect(screen.getByText('Stop Annapurna Caterers exceeds the remaining vehicle capacity (80 > 50).')).toBeInTheDocument();
  });

  it('labels straight-line estimates and road distances', () => {
    const { unmount } = renderWithProviders(<PlanDetailView plan={plan} />, { auth: authValue({ user: ngoOwner }) });
    expect(screen.getByTestId('distance-source')).toHaveTextContent('Straight-line estimates, not road distances');
    expect(screen.getByText('12.4 km')).toBeInTheDocument();
    unmount();
    renderWithProviders(<PlanDetailView plan={{ ...plan, distanceSource: 'ROAD_GOOGLE_ROUTES' }} />, { auth: authValue({ user: ngoOwner }) });
    expect(screen.getByTestId('distance-source')).toHaveTextContent('Road distances and travel times (Google Routes)');
  });

  it('is honest when the optimiser is unavailable', () => {
    const unsequenced = { ...plan, solverStatus: 'UNAVAILABLE', totalDistanceM: null, totalDurationS: null, infeasibilityReasons: ['AI route optimiser unavailable'], stops: plan.stops.map((s) => ({ ...s, sequence: null, plannedArrivalAt: null, status: s.type === 'PICKUP' ? 'PENDING' : s.status, dropReason: null })) };
    renderWithProviders(<PlanDetailView plan={unsequenced} />, { auth: authValue({ user: ngoOwner }) });
    expect(screen.getByText('Route optimisation is unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('markers:S,–,–,– path:0');
    expect(screen.getByText('Optimiser unavailable')).toBeInTheDocument();
  });
});
