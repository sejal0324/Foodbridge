import { Activity, Database, Mail, RotateCw, Server } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, PageHeader, Select, SkeletonList, StatusBadge, Tabs, useToast } from '@/components/ui';
import { formatDateTime, formatRelative, humanize } from '@/utils/format';
import { useJobs, useNotificationDeliveries, useReadiness, useRetryJob } from '../api';
import { FilterBar, SimplePager } from '../components/common';
import { useUrlFilters } from '../hooks';
import { integrationInfo } from '../labels';
import type { BackgroundJob, JobStatus } from '../types';

const JOB_STATUSES: JobStatus[] = ['DEAD', 'FAILED', 'PENDING', 'RUNNING', 'SUCCEEDED'];
const PAGE_SIZE = 20;

export default function SystemHealthPage() {
  return (
    <>
      <PageHeader title="System health" description="Database and integration status, background jobs and notification deliveries." />
      <div className="space-y-6">
        <ReadinessCard />
        <JobsCard />
        <DeliveriesCard />
      </div>
    </>
  );
}

function ReadinessCard() {
  const query = useReadiness();
  return (
    <Card>
      <CardHeader
        title="Readiness"
        description="From GET /api/health/ready. Integrations are reported honestly: a development fallback is never shown as production-ready."
        icon={<Server className="size-4" aria-hidden="true" />}
        actions={query.data ? <Badge tone={query.data.status === 'ready' ? 'success' : 'danger'} dot>{query.data.status === 'ready' ? 'Ready' : 'Not ready'}</Badge> : null}
      />
      <CardBody>
        {query.isPending ? (
          <SkeletonList rows={2} />
        ) : query.isError ? (
          <ErrorState error={query.error} compact title="The backend reported that it is not ready (the database may be unavailable)" onRetry={() => void query.refetch()} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <li className="rounded-xl border border-white/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  <Database className="size-4 text-slate-400" aria-hidden="true" /> Database
                </p>
                <Badge tone={query.data.checks.database === 'ok' ? 'success' : 'danger'}>{query.data.checks.database === 'ok' ? 'OK' : 'Unavailable'}</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-400">PostgreSQL with PostGIS. Readiness fails when it cannot be reached.</p>
            </li>
            {(['email', 'maps', 'payments'] as const).map((name) => {
              const info = integrationInfo(name, query.data.integrations[name]);
              return (
                <li key={name} className="rounded-xl border border-white/10 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{{ email: 'Email', maps: 'Maps and routing', payments: 'Online payments' }[name]}</p>
                    <Badge tone={info.tone}>{info.label}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{info.detail}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">reported: {query.data.integrations[name]}</p>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function JobsCard() {
  const filters = useUrlFilters(['jobStatus', 'jobPage'] as const, { jobStatus: 'DEAD' });
  const status = (JOB_STATUSES.includes(filters.values.jobStatus as JobStatus) ? filters.values.jobStatus : 'DEAD') as JobStatus;
  const page = Math.max(1, Number(filters.values.jobPage) || 1);
  const query = useJobs({ status, page, pageSize: PAGE_SIZE });
  const counts = query.data?.counts ?? {};
  const [retrying, setRetrying] = useState<BackgroundJob | null>(null);
  const retry = useRetryJob();
  const toast = useToast();

  return (
    <Card id="jobs">
      <CardHeader title="Background jobs" description="Scheduled and queued work (expiry, forecasts, notifications). A job becomes DEAD after its last failed attempt and can be retried once the cause is fixed." icon={<Activity className="size-4" aria-hidden="true" />} />
      <div className="px-5 pt-3">
        <Tabs
          label="Job status"
          value={status}
          onChange={(v) => filters.set({ jobStatus: v, jobPage: '' })}
          items={JOB_STATUSES.map((s) => ({ value: s, label: humanize(s), count: counts[s] ?? 0 }))}
        />
      </div>
      <CardBody className="space-y-4">
        {status === 'DEAD' && (counts.DEAD ?? 0) > 0 ? <Banner tone="danger">{counts.DEAD} job{counts.DEAD === 1 ? ' has' : 's have'} stopped retrying. Check the last error, fix the cause, then retry.</Banner> : null}
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title={status === 'DEAD' ? 'No dead jobs' : `No ${humanize(status).toLowerCase()} jobs`} />}>
          {(data) => (
            <>
              <DataTable
                caption={`${humanize(status)} jobs`}
                rows={data.items}
                rowKey={(r) => String(r.id)}
                columns={[
                  {
                    key: 'type',
                    header: 'Job',
                    cell: (r) => (
                      <div>
                        <p className="font-mono text-xs text-white">{r.type}</p>
                        <p className="text-xs text-slate-500">#{r.id}</p>
                      </div>
                    ),
                  },
                  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                  { key: 'attempts', header: 'Attempts', align: 'right', cell: (r) => `${r.attempts} / ${r.maxAttempts}` },
                  { key: 'run', header: 'Run at', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.runAt)}</span>, hideOnMobile: true },
                  { key: 'error', header: 'Last error', cell: (r) => (r.lastError ? <span className="line-clamp-3 font-mono text-xs break-all text-red-200" title={r.lastError}>{r.lastError}</span> : <span className="text-slate-500">—</span>) },
                  { key: 'updated', header: 'Updated', cell: (r) => <span className="text-xs text-slate-400" title={formatDateTime(r.updatedAt)}>{formatRelative(r.updatedAt)}</span> },
                  {
                    key: 'actions',
                    header: <span className="sr-only">Actions</span>,
                    cell: (r) =>
                      r.status === 'DEAD' ? (
                        <Button size="sm" variant="outline" leftIcon={<RotateCw className="size-4" aria-hidden="true" />} onClick={() => setRetrying(r)} aria-label={`Retry job ${r.id}`}>
                          Retry
                        </Button>
                      ) : null,
                  },
                ]}
              />
              <SimplePager page={page} hasNext={page * PAGE_SIZE < (counts[status] ?? 0)} onPageChange={(p) => filters.set({ jobPage: p > 1 ? String(p) : '' })} />
            </>
          )}
        </QueryState>
      </CardBody>
      <ConfirmDialog
        open={retrying !== null}
        onClose={() => setRetrying(null)}
        title={retrying ? `Retry job #${retrying.id}?` : 'Retry job?'}
        description={retrying?.type}
        confirmLabel="Retry job"
        loading={retry.isPending}
        onConfirm={() =>
          retrying
            ? retry
                .mutateAsync(retrying.id)
                .then(() => {
                  toast.success('Job re-queued', 'It runs again with its attempts reset.');
                  setRetrying(null);
                })
                .catch((e: unknown) => toast.error(e))
            : undefined
        }
      >
        <p className="text-sm text-slate-300">The job is set back to pending with its attempt count reset. If the cause of the failure has not been fixed it will fail again. The retry is recorded in the audit log.</p>
      </ConfirmDialog>
    </Card>
  );
}

function DeliveriesCard() {
  const filters = useUrlFilters(['deliveryStatus', 'deliveryPage'] as const);
  const page = Math.max(1, Number(filters.values.deliveryPage) || 1);
  const query = useNotificationDeliveries({ status: filters.values.deliveryStatus || undefined, page, pageSize: PAGE_SIZE });
  return (
    <Card>
      <CardHeader title="Notification deliveries" description="Email delivery attempts for in-app notifications. With the development email log, “sent” means written to the server log." icon={<Mail className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <FilterBar>
          <Field label="Delivery status" className="w-44">
            <Select
              value={filters.values.deliveryStatus}
              onChange={(e) => filters.set({ deliveryStatus: e.target.value, deliveryPage: '' })}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'SENT', label: 'Sent' },
                { value: 'FAILED', label: 'Failed' },
                { value: 'SKIPPED', label: 'Skipped' },
              ]}
            />
          </Field>
        </FilterBar>
        <QueryState query={query} isEmpty={(d) => d.length === 0 && page === 1} empty={<EmptyState compact title="No deliveries match" />}>
          {(rows) => (
            <>
              <DataTable
                caption="Notification deliveries"
                rows={rows}
                rowKey={(r) => String(r.id)}
                columns={[
                  {
                    key: 'title',
                    header: 'Notification',
                    cell: (r) => (
                      <div className="min-w-0">
                        <p className="text-white">{r.title}</p>
                        <p className="font-mono text-xs text-slate-500">{r.notificationType}</p>
                      </div>
                    ),
                  },
                  { key: 'to', header: 'Recipient', cell: (r) => <span className="text-xs break-all">{r.recipient}</span> },
                  { key: 'channel', header: 'Channel', cell: (r) => humanize(r.channel), hideOnMobile: true },
                  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                  { key: 'attempts', header: 'Attempts', align: 'right', cell: (r) => r.attemptCount, hideOnMobile: true },
                  { key: 'error', header: 'Last error', cell: (r) => (r.lastError ? <span className="font-mono text-xs break-all text-red-200">{r.lastError}</span> : <span className="text-slate-500">—</span>) },
                  { key: 'updated', header: 'Updated', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.updatedAt)}</span>, hideOnMobile: true },
                ]}
              />
              <SimplePager page={page} hasNext={rows.length === PAGE_SIZE} onPageChange={(p) => filters.set({ deliveryPage: p > 1 ? String(p) : '' })} />
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
