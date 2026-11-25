import { Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, ButtonLink, Card, Countdown, DataTable, EmptyState, PageHeader, QuantityBadge, StatusBadge, Tabs } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { usePickups } from '@/features/pickups/api';
import type { Pickup } from '@/types';
import { formatDateTime } from '@/utils/format';
import { isNgoOwner } from '../access';

export default function PickupListPage() {
  const user = useCurrentUser();
  const owner = isNgoOwner(user);
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const query = usePickups(tab === 'active' ? { active: true } : {});
  return (
    <>
      <PageHeader
        title={owner ? 'Pickups' : 'My pickups'}
        description={
          owner
            ? 'Every collection a representative is assigned to: verification, handover, location sharing and delivery.'
            : 'Collections assigned to you. Open one to show your pickup pass, share your location and confirm the handover.'
        }
        actions={
          owner ? (
            <ButtonLink to="/ngo/collections" variant="outline">
              Assign collections
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <div className="px-5 pt-3">
          <Tabs
            label="Pickup filter"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'active', label: 'Active' },
              { value: 'all', label: 'All pickups' },
            ]}
          />
        </div>
        <div className="p-5">
          <QueryState
            query={query}
            empty={
              <EmptyState
                icon={<Truck className="size-6" aria-hidden="true" />}
                title={tab === 'active' ? 'No active pickups' : 'No pickups yet'}
                description={owner ? 'Assign a representative to a reserved collection and the pickup appears here.' : 'When your NGO assigns you a collection, it appears here.'}
              />
            }
          >
            {(rows) => <NgoPickupTable rows={rows} />}
          </QueryState>
        </div>
      </Card>
    </>
  );
}

function NgoPickupTable({ rows }: { rows: Pickup[] }) {
  return (
    <DataTable
      caption="Pickups"
      rows={rows}
      rowKey={(r) => r.id}
      mobileTitle={(r) => (
        <Link to={`/ngo/pickups/${r.id}`} className="hover:underline">
          {r.donation.foodName}
        </Link>
      )}
      columns={[
        {
          key: 'food',
          header: 'Food',
          cell: (r) => (
            <Link to={`/ngo/pickups/${r.id}`} className="font-medium text-white hover:underline">
              {r.donation.foodName}
            </Link>
          ),
        },
        { key: 'qty', header: 'Quantity', cell: (r) => <QuantityBadge quantity={r.donation.quantity} unit={r.donation.unit} muted /> },
        {
          key: 'donor',
          header: 'Donor',
          cell: (r) => (
            <div>
              <p>{r.donor.name}</p>
              <p className="text-xs text-slate-400">{r.donation.address}</p>
            </div>
          ),
        },
        {
          key: 'rep',
          header: 'Representative',
          cell: (r) => (
            <span className="inline-flex items-center gap-2">
              {r.representative.name}
              {r.viewer === 'REPRESENTATIVE' ? <Badge tone="brand">you</Badge> : null}
            </span>
          ),
        },
        { key: 'when', header: 'Scheduled', cell: (r) => (['ASSIGNED', 'EN_ROUTE'].includes(r.status) ? <span className="inline-flex flex-col">{r.scheduledPickupAt ? <span>{formatDateTime(r.scheduledPickupAt)}</span> : null}<Countdown to={r.donation.pickupDeadline} /></span> : r.scheduledPickupAt ? formatDateTime(r.scheduledPickupAt) : '—') },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
