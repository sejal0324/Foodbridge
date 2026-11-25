import { Map as MapIcon, MapPinned, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MapView } from '@/components/map';
import { Button, Card, CardBody, CardHeader, DataTable, EmptyState } from '@/components/ui';
import { formatNumber, formatPercent } from '@/utils/format';
import { cityMarkers } from '../helpers';
import type { CityDistribution } from '../types';

/**
 * Donations per city on the shared India map (auto-fitted, one labelled marker
 * per city) with an accessible table view of the same numbers.
 */
export function GeographicDistributionCard({ rows }: { rows: CityDistribution[] }) {
  const [view, setView] = useState<'map' | 'table'>('map');
  const markers = useMemo(() => cityMarkers(rows), [rows]);
  const total = rows.reduce((s, r) => s + r.donations, 0);
  return (
    <Card>
      <CardHeader
        title="Donations across India"
        description="Each marker is a city, labelled with its number of donations (top 20 cities by donor location)."
        icon={<MapPinned className="size-4" aria-hidden="true" />}
        actions={
          rows.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === 'table'}
              onClick={() => setView((v) => (v === 'map' ? 'table' : 'map'))}
              leftIcon={view === 'map' ? <Table2 className="size-4" aria-hidden="true" /> : <MapIcon className="size-4" aria-hidden="true" />}
            >
              {view === 'map' ? 'Table' : 'Map'}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState compact title="No donations yet" description="Cities appear here once donors list food." />
        ) : view === 'map' ? (
          <>
            <MapView ariaLabel={`Map of India with donation counts for ${markers.length} cities`} markers={markers} fitToContent height={380} />
            <p className="mt-2 text-xs text-slate-500">Hover or focus a marker for the city, its donations and the units listed. Switch to the table for the full list.</p>
          </>
        ) : (
          <DataTable
            caption="Donations by city"
            rows={rows}
            rowKey={(r) => r.city}
            columns={[
              { key: 'city', header: 'City', cell: (r) => <span className="font-medium text-white">{r.city}</span> },
              { key: 'donations', header: 'Donations', align: 'right', cell: (r) => formatNumber(r.donations) },
              { key: 'share', header: 'Share', align: 'right', cell: (r) => (total > 0 ? formatPercent(r.donations / total) : '—') },
              { key: 'quantity', header: 'Units listed', align: 'right', cell: (r) => formatNumber(r.quantity) },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}
