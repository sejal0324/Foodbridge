import { QrCode, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { ButtonLink, Card, Countdown, DataTable, EmptyState, PageHeader, QuantityBadge, StatusBadge, Tabs } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import type { Pickup } from '@/types';
import { formatDateTime } from '@/utils/format';
import { usePickups } from '../api';

export default function PickupListPage() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const query = usePickups(tab === 'active' ? { active: true } : {});
  return (
    <>
      <PageHeader
        title="Pickups"
        description="NGO representatives assigned to collect your food. Verify each one with their QR pass and photo ID before handing over."
        actions={
          isOrganisationApproved(user) ? (
            <ButtonLink to="/donor/pickups/verify" leftIcon={<QrCode className="size-4" aria-hidden="true" />}>
              Verify a pickup
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
                description="When an NGO assigns a representative to one of your reservations, the pickup appears here."
              />
            }
          >
            {(rows) => <PickupTable rows={rows} />}
          </QueryState>
        </div>
      </Card>
    </>
  );
}

export function PickupTable({ rows }: { rows: Pickup[] }) {
  return (
    <DataTable
      caption="Pickups"
      rows={rows}
      rowKey={(r) => r.id}
      mobileTitle={(r) => (
        <Link to={`/donor/pickups/${r.id}`} className="hover:underline">
          {r.donation.foodName}
        </Link>
      )}
      columns={[
        {
          key: 'food',
          header: 'Food',
          cell: (r) => (
            <Link to={`/donor/pickups/${r.id}`} className="font-medium text-white hover:underline">
              {r.donation.foodName}
            </Link>
          ),
        },
        { key: 'qty', header: 'Quantity', cell: (r) => <QuantityBadge quantity={r.donation.quantity} unit={r.donation.unit} muted /> },
        { key: 'ngo', header: 'NGO', cell: (r) => r.ngo.name },
        { key: 'rep', header: 'Representative', cell: (r) => r.representative.name },
        { key: 'when', header: 'Scheduled', cell: (r) => (r.scheduledPickupAt ? formatDateTime(r.scheduledPickupAt) : <Countdown to={r.donation.pickupDeadline} />) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
