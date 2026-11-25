import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const containerProps: Record<string, unknown>[] = [];
const fitCalls: string[] = [];

vi.mock('react-leaflet', () => ({
  MapContainer: (props: Record<string, unknown> & { children?: ReactNode }) => {
    containerProps.push(props);
    return <div data-testid="map">{props.children}</div>;
  },
  TileLayer: (props: { attribution: string }) => <div data-testid="tiles" data-attribution={props.attribution} />,
  Marker: () => null,
  Polyline: () => null,
  Tooltip: () => null,
  useMapEvents: () => null,
  useMap: () => ({
    getBounds: () => ({ pad: () => ({ contains: () => false }) }),
    getZoom: () => 5,
    setView: (_p: unknown, z: number) => fitCalls.push(`setView:${z}`),
    fitBounds: (_b: unknown, o: { maxZoom: number }) => fitCalls.push(`fitBounds:max${o.maxZoom}`),
  }),
}));

const { default: LeafletMap } = await import('./LeafletMap');

describe('<MapView> (Leaflet) defaults for India', () => {
  it('opens on India at zoom 5 with soft India bounds when there is nothing to show', () => {
    containerProps.length = 0;
    const { getByTestId } = render(<LeafletMap ariaLabel="Map" />);
    expect(containerProps[0]).toMatchObject({ center: [22.5, 80], zoom: 5, maxBounds: [[5.5, 67.5], [37.8, 98]], maxBoundsViscosity: 0.8 });
    expect(getByTestId('tiles').dataset.attribution).toContain('OpenStreetMap');
  });

  it('fits to markers and paths (max zoom 15) instead of using a fixed city', () => {
    containerProps.length = 0;
    fitCalls.length = 0;
    render(
      <LeafletMap
        ariaLabel="Map"
        markers={[
          { id: 'a', position: { lat: 28.61, lng: 77.21 } },
          { id: 'b', position: { lat: 19.07, lng: 72.88 } },
        ]}
      />,
    );
    expect(containerProps[0]).toMatchObject({ center: [28.61, 77.21] });
    expect(fitCalls).toEqual(['fitBounds:max15']);
  });

  it('zooms in on a single point', () => {
    fitCalls.length = 0;
    render(<LeafletMap ariaLabel="Map" picked={{ lat: 13.06, lng: 80.25 }} />);
    expect(fitCalls).toEqual(['setView:14']);
  });
});
