import { History, Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, Button, Card, DataTable, EmptyState, Field, Input, PageHeader, Pagination, Select, StatusBadge } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDateTime, formatRelative } from '@/utils/format';
import { useAdminUsers } from '../api';
import { FilterBar } from '../components/common';
import { UserStatusDialog } from '../components/UserStatusDialog';
import { useUrlFilters } from '../hooks';
import { ROLE_LABELS } from '../labels';
import type { AdminUser } from '../types';

const ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: 'DONOR', label: 'Donors' },
  { value: 'NGO', label: 'NGOs' },
  { value: 'ADMIN', label: 'Admins' },
];
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

export default function UsersPage() {
  const me = useCurrentUser();
  const filters = useUrlFilters(['role', 'status', 'search'] as const);
  const [searchText, setSearchText] = useState(filters.values.search);
  const debounced = useDebouncedValue(searchText.trim(), 400);
  const { set: setFilters, values } = filters;
  useEffect(() => {
    if (debounced !== values.search) setFilters({ search: debounced });
    // Only react to the debounced text, not to every URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const query = useAdminUsers({ page: filters.page, role: values.role, status: values.status, search: values.search });
  const [action, setAction] = useState<{ user: AdminUser; status: 'ACTIVE' | 'SUSPENDED' } | null>(null);

  return (
    <>
      <PageHeader title="Users" description="Every account on FoodBridge. Suspending a user signs them out immediately; you cannot change your own account." />
      <Card>
        <div className="space-y-4 p-5">
          <FilterBar
            active={filters.active}
            onReset={() => {
              setSearchText('');
              filters.reset();
            }}
          >
            <Field label="Search" className="w-full sm:w-72">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <Input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Name or email" className="pl-9" maxLength={100} />
              </div>
            </Field>
            <Field label="Role" className="w-40">
              <Select value={values.role} onChange={(e) => filters.set({ role: e.target.value })} options={ROLE_OPTIONS} />
            </Field>
            <Field label="Account status" className="w-44">
              <Select value={values.status} onChange={(e) => filters.set({ status: e.target.value })} options={STATUS_OPTIONS} />
            </Field>
          </FilterBar>
          <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={<Users className="size-6" aria-hidden="true" />} title="No users match these filters" />}>
            {(data) => (
              <>
                <UsersTable rows={data.items} currentUserId={me.id} onAction={(user, status) => setAction({ user, status })} />
                <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => filters.set({ page: p })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
      {action ? <UserStatusDialog user={action.user} status={action.status} onClose={() => setAction(null)} /> : null}
    </>
  );
}

export function UsersTable({ rows, currentUserId, onAction }: { rows: AdminUser[]; currentUserId: string; onAction: (user: AdminUser, status: 'ACTIVE' | 'SUSPENDED') => void }) {
  return (
    <DataTable
      caption="Users"
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        {
          key: 'user',
          header: 'User',
          cell: (r) => (
            <div className="min-w-0">
              <p className="font-medium text-white">
                {r.fullName} {r.id === currentUserId ? <Badge tone="brand">You</Badge> : null}
              </p>
              <p className="truncate text-xs text-slate-500">{r.email}</p>
            </div>
          ),
        },
        { key: 'role', header: 'Role', cell: (r) => ROLE_LABELS[r.role] ?? r.role },
        { key: 'org', header: 'Organisation', cell: (r) => r.organizationName ?? <span className="text-slate-500">—</span> },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.accountStatus} /> },
        { key: 'login', header: 'Last sign-in', cell: (r) => <span className="text-xs text-slate-400" title={formatDateTime(r.lastLoginAt)}>{r.lastLoginAt ? formatRelative(r.lastLoginAt) : 'Never'}</span>, hideOnMobile: true },
        {
          key: 'actions',
          header: <span className="sr-only">Actions</span>,
          cell: (r) => (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link to={`/admin/audit?entityType=user&entityId=${r.id}`} className="inline-flex items-center text-slate-400 hover:text-white" aria-label={`Audit trail for ${r.email}`} title="Audit trail">
                <History className="size-4" aria-hidden="true" />
              </Link>
              {r.id === currentUserId ? (
                <span className="text-xs text-slate-400">Your own account cannot be changed here</span>
              ) : r.accountStatus === 'ACTIVE' ? (
                <Button size="sm" variant="outline" onClick={() => onAction(r, 'SUSPENDED')} aria-label={`Suspend ${r.email}`}>
                  Suspend
                </Button>
              ) : r.accountStatus === 'SUSPENDED' ? (
                <Button size="sm" variant="outline" onClick={() => onAction(r, 'ACTIVE')} aria-label={`Reactivate ${r.email}`}>
                  Reactivate
                </Button>
              ) : (
                <span className="text-xs text-slate-500">{r.accountStatus === 'INVITED' ? 'Awaiting activation' : 'No actions'}</span>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
