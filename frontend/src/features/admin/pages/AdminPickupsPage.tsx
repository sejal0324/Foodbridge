import { Check, Eye, Minus, Radio, ShieldAlert, Truck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, ButtonLink, Card, Checkbox, DataTable, EmptyState, Field, PageHeader, Select, StatusBadge, TabPanel, Tabs, statusStyle } from '@/components/ui';
import { usePickups } from '@/features/pickups/api';
import { useNow } from '@/hooks/useNow';
import type { Pickup } from '@/types';
import { formatDateTime, formatQuantity, formatRelative, humanize } from '@/utils/format';
import { useActiveTrackingSessions, useVerificationLog } from '../api';
import { isOverdue } from '../helpers';
import { FilterBar, ShortId } from '../components/common';
import { useUrlFilters } from '../hooks';
import { PICKUP_STATUS_OPTIONS, VERIFICATION_METHOD_LABELS } from '../labels';

type TabValue = 'pickups' | 'verification' | 'tracking';
const TABS: { value: TabValue; label: string }[] = [
  { value: 'pickups', label: 'Pickups' },
  { value: 'verification', label: 'Verification log' },
  { value: 'tracking', label: 'Live tracking' },
];

export default function AdminPickupsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'pickups') as TabValue;
  const setTab = (v: TabValue) => {
    const p = new URLSearchParams();
    if (v !== 'pickups') p.set('tab', v);
    setParams(p, { replace: true });
  };
  return (
    <>
      <PageHeader title="Pickups and verification" description="Every collection, the QR pass and ID verification attempts behind it, and live representative tracking." />
      <Card>
        <div className="px-5 pt-3">
          <Tabs label="Pickup views" idPrefix="admin-pickups" value={tab} onChange={setTab} items={TABS} />
        </div>
        <TabPanel value={tab} idPrefix="admin-pickups" className="space-y-4 p-5 focus:outline-none">
          {tab === 'pickups' ? <PickupsTab /> : tab === 'verification' ? <VerificationLogTab /> : <TrackingTab />}
        </TabPanel>
      </Card>
    </>
  );
}

function PickupsTab() {
  const filters = useUrlFilters(['status', 'overdue'] as const);
  const query = usePickups(filters.values.status ? { status: filters.values.status } : {});
  const now = useNow(60_000);
  const overdueOnly = filters.values.overdue === '1';
  return (
    <>
      <FilterBar active={Boolean(filters.values.status) || overdueOnly} onReset={() => filters.set({ status: '', overdue: '' })}>
        <Field label="Status" className="w-48">
          <Select
            value={filters.values.status}
            onChange={(e) => filters.set({ status: e.target.value })}
            options={[{ value: '', label: 'All statuses' }, ...PICKUP_STATUS_OPTIONS.map((s) => ({ value: s, label: statusStyle(s).label }))]}
          />
        </Field>
        <Checkbox className="mb-2" label="Overdue only" checked={overdueOnly} onChange={(e) => filters.set({ overdue: e.target.checked ? '1' : '' })} />
      </FilterBar>
      <QueryState query={query} empty={<EmptyState icon={<Truck className="size-6" aria-hidden="true" />} title="No pickups match" />}>
        {(rows) => {
          const overdue = rows.filter((r) => isOverdue(r, now));
          const shown = overdueOnly ? overdue : rows;
          return (
            <>
              {overdue.length > 0 ? (
                <Banner tone="warning" title={`${overdue.length} pickup${overdue.length === 1 ? ' is' : 's are'} past the pickup deadline`}>
                  These were not verified and handed over before the donation’s deadline. Check with the NGO or donor; the food may no longer be safe to collect.
                </Banner>
              ) : null}
              {shown.length === 0 ? (
                <EmptyState compact title="No overdue pickups" />
              ) : (
                <PickupTable rows={shown} now={now} />
              )}
              {rows.length >= 200 ? <p className="text-xs text-slate-500">Showing the latest 200 pickups (the API limit). Filter by status to narrow the list.</p> : null}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function CheckMark({ at, label }: { at: string | null; label: string }) {
  return (
    <span title={at ? `${label}: ${formatDateTime(at)}` : `${label}: not yet`} className={at ? 'inline-flex items-center gap-0.5 text-emerald-300' : 'inline-flex items-center gap-0.5 text-slate-500'}>
      {at ? <Check className="size-3.5" aria-hidden="true" /> : <Minus className="size-3.5" aria-hidden="true" />}
      <span className="text-xs">{label}</span>
      <span className="sr-only">{at ? 'done' : 'not yet'}</span>
    </span>
  );
}

function PickupTable({ rows, now }: { rows: Pickup[]; now: number }) {
  return (
    <DataTable
      caption="Pickups"
      rows={rows}
      rowKey={(r) => r.id}
      mobileTitle={(r) => (
        <Link to={`/admin/pickups/${r.id}`} className="hover:underline">
          {r.donation.foodName}
        </Link>
      )}
      columns={[
        {
          key: 'food',
          header: 'Collection',
          cell: (r) => (
            <div>
              <Link to={`/admin/pickups/${r.id}`} className="font-medium text-white hover:underline">
                {r.donation.foodName}
              </Link>
              <p className="text-xs text-slate-500">{formatQuantity(r.donation.quantity, r.donation.unit)}</p>
            </div>
          ),
        },
        {
          key: 'parties',
          header: 'Donor → NGO',
          cell: (r) => (
            <div className="text-sm">
              <p className="text-slate-200">{r.donor.name}</p>
              <p className="text-xs text-slate-500">
                → {r.ngo.name} · {r.representative.name}
              </p>
            </div>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          cell: (r) => (
            <div className="flex flex-wrap justify-end gap-1 md:justify-start">
              <StatusBadge status={r.status} />
              {isOverdue(r, now) ? (
                <Badge tone="danger" icon={<ShieldAlert className="size-3" aria-hidden="true" />}>
                  Overdue
                </Badge>
              ) : null}
            </div>
          ),
        },
        {
          key: 'deadline',
          header: 'Pickup deadline',
          cell: (r) => <span className={isOverdue(r, now) ? 'text-xs font-medium text-red-300' : 'text-xs text-slate-400'}>{formatDateTime(r.donation.pickupDeadline)}</span>,
        },
        {
          key: 'checks',
          header: 'Checks',
          cell: (r) => (
            <span className="inline-flex flex-wrap gap-2">
              <CheckMark at={r.checks.qrVerifiedAt} label="QR" />
              <CheckMark at={r.checks.identityConfirmedAt} label="ID" />
            </span>
          ),
          hideOnMobile: true,
        },
      ]}
    />
  );
}

function VerificationLogTab() {
  const filters = useUrlFilters(['result', 'method'] as const);
  const query = useVerificationLog();
  const { result, method } = filters.values;
  return (
    <>
      <FilterBar active={Boolean(result || method)} onReset={() => filters.set({ result: '', method: '' })}>
        <Field label="Result" className="w-40">
          <Select
            value={result}
            onChange={(e) => filters.set({ result: e.target.value })}
            options={[
              { value: '', label: 'All results' },
              { value: 'SUCCESS', label: 'Success' },
              { value: 'FAILURE', label: 'Failure' },
            ]}
          />
        </Field>
        <Field label="Method" className="w-40">
          <Select
            value={method}
            onChange={(e) => filters.set({ method: e.target.value })}
            options={[{ value: '', label: 'All methods' }, ...Object.entries(VERIFICATION_METHOD_LABELS).map(([value, label]) => ({ value, label }))]}
          />
        </Field>
      </FilterBar>
      <QueryState query={query} empty={<EmptyState compact title="No verification attempts yet" description="QR scans and ID checks by donors appear here." />}>
        {(all) => {
          const rows = all.filter((r) => (!result || r.result === result) && (!method || r.method === method));
          return rows.length === 0 ? (
            <EmptyState compact title="No attempts match these filters" />
          ) : (
            <>
              <DataTable
                caption="QR pass and ID verification attempts"
                rows={rows}
                rowKey={(r) => String(r.id)}
                columns={[
                  { key: 'time', header: 'Time', cell: (r) => <span className="text-xs text-slate-300">{formatDateTime(r.createdAt)}</span> },
                  { key: 'method', header: 'Method', cell: (r) => VERIFICATION_METHOD_LABELS[r.method] ?? r.method },
                  { key: 'result', header: 'Result', cell: (r) => <Badge tone={r.result === 'SUCCESS' ? 'success' : 'danger'}>{r.result === 'SUCCESS' ? 'Success' : 'Failure'}</Badge> },
                  { key: 'reason', header: 'Failure reason', cell: (r) => (r.failureReason ? <span className="text-xs text-red-200">{humanize(r.failureReason)}</span> : <span className="text-slate-500">—</span>) },
                  { key: 'actor', header: 'Actor', cell: (r) => <span className="text-xs break-all">{r.actorEmail ?? '—'}</span> },
                  { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-xs text-slate-400">{r.ip ?? '—'}</span>, hideOnMobile: true },
                  {
                    key: 'pickup',
                    header: 'Pickup',
                    cell: (r) =>
                      r.pickupId ? (
                        <Link to={`/admin/pickups/${r.pickupId}`} className="text-brand-300 hover:underline" aria-label={`Open pickup ${r.pickupId}`}>
                          <ShortId id={r.pickupId} />
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-500">Unknown pass</span>
                      ),
                  },
                ]}
              />
              <p className="text-xs text-slate-500">The latest 200 attempts. Failed attempts are also written to the audit log.</p>
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function TrackingTab() {
  const query = useActiveTrackingSessions();
  return (
    <>
      <Banner tone="info" title="Viewing live locations is recorded in the audit log.">
        Representatives share their location only while a pickup is in progress and with their consent. Open a session only when you need to.
      </Banner>
      <QueryState query={query} empty={<EmptyState compact icon={<Radio className="size-6" aria-hidden="true" />} title="No active tracking sessions" description="Sessions appear while representatives share their location." />}>
        {(rows) => (
          <DataTable
            caption="Active tracking sessions"
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'rep', header: 'Representative', cell: (r) => <span className="font-medium text-white">{r.representativeName}</span> },
              { key: 'ngo', header: 'NGO', cell: (r) => r.ngoName },
              { key: 'stage', header: 'Stage', cell: (r) => (r.stage === 'TO_PICKUP' ? 'To the pickup point' : 'To the destination') },
              { key: 'started', header: 'Started', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.startedAt)}</span> },
              { key: 'last', header: 'Last position', cell: (r) => <span className="text-xs text-slate-400">{r.lastRecordedAt ? formatRelative(r.lastRecordedAt) : 'None yet'}</span> },
              {
                key: 'open',
                header: <span className="sr-only">Actions</span>,
                cell: (r) => (
                  <ButtonLink to={`/admin/pickups/tracking/${r.id}`} size="sm" variant="outline" leftIcon={<Eye className="size-4" aria-hidden="true" />} aria-label={`View live location of ${r.representativeName}`}>
                    View
                  </ButtonLink>
                ),
              },
            ]}
          />
        )}
      </QueryState>
    </>
  );
}
