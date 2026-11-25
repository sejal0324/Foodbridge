import { ScrollText, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { QueryState } from '@/components/feedback';
import { Button, Card, EmptyState, Field, Input, PageHeader, Pagination } from '@/components/ui';
import { useAuditLogs } from '../api';
import { AuditLogList } from '../components/AuditLogList';
import { useUrlFilters } from '../hooks';
import { AUDIT_ENTITY_TYPES } from '../labels';
import { UUID_RE } from '../schemas';

const KEYS = ['action', 'entityType', 'entityId', 'actorUserId'] as const;
type Key = (typeof KEYS)[number];

export default function AuditLogPage() {
  const filters = useUrlFilters(KEYS);
  const { values } = filters;
  const [draft, setDraft] = useState<Record<Key, string>>(values);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  // Only send ids the API accepts (it validates them as UUIDs).
  const validUrl = (k: 'entityId' | 'actorUserId') => (values[k] && UUID_RE.test(values[k]) ? values[k] : undefined);
  const query = useAuditLogs({ page: filters.page, action: values.action || undefined, entityType: values.entityType || undefined, entityId: validUrl('entityId'), actorUserId: validUrl('actorUserId') });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const next = Object.fromEntries(KEYS.map((k) => [k, draft[k].trim()])) as Record<Key, string>;
    const errs: Partial<Record<Key, string>> = {};
    if (next.entityId && !UUID_RE.test(next.entityId)) errs.entityId = 'Enter a full id (UUID), e.g. 3d89c1ba-cb1f-47e8-90f5-3538115a4629';
    if (next.actorUserId && !UUID_RE.test(next.actorUserId)) errs.actorUserId = 'Enter a full user id (UUID)';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    filters.set(next);
  };

  const clear = () => {
    setDraft({ action: '', entityType: '', entityId: '', actorUserId: '' });
    setErrors({});
    filters.reset();
  };

  return (
    <>
      <PageHeader title="Audit log" description="An append-only record of security-relevant and administrative actions: who did what, to which record, when and from where." />
      <Card>
        <form className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]" onSubmit={apply} noValidate aria-label="Filter the audit log">
          <Field label="Action starts with" hint="e.g. verification., settings.updated">
            <Input value={draft.action} onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))} maxLength={80} placeholder="Any action" />
          </Field>
          <Field label="Entity type">
            <Input value={draft.entityType} onChange={(e) => setDraft((d) => ({ ...d, entityType: e.target.value }))} maxLength={60} placeholder="Any type" list="audit-entity-types" />
          </Field>
          <Field label="Entity ID" error={errors.entityId}>
            <Input value={draft.entityId} onChange={(e) => setDraft((d) => ({ ...d, entityId: e.target.value }))} placeholder="UUID" className="font-mono" spellCheck={false} />
          </Field>
          <Field label="Actor user ID" error={errors.actorUserId}>
            <Input value={draft.actorUserId} onChange={(e) => setDraft((d) => ({ ...d, actorUserId: e.target.value }))} placeholder="UUID" className="font-mono" spellCheck={false} />
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
            <Button type="submit" leftIcon={<Search className="size-4" aria-hidden="true" />}>
              Apply
            </Button>
            {filters.active ? (
              <Button variant="ghost" onClick={clear}>
                Clear
              </Button>
            ) : null}
          </div>
          <datalist id="audit-entity-types">
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </form>
        <div className="space-y-4 p-5">
          <QueryState
            query={query}
            isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState icon={<ScrollText className="size-6" aria-hidden="true" />} title={filters.active ? 'No entries match these filters' : 'No audit entries yet'} />}
          >
            {(data) => (
              <>
                <p className="text-xs text-slate-400">
                  {data.meta.total.toLocaleString('en-IN')} entries{filters.active ? ' match' : ''}. Select a row to see the changes, metadata, request id and IP address.
                </p>
                <AuditLogList entries={data.items} />
                <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={(p) => filters.set({ page: p })} />
              </>
            )}
          </QueryState>
        </div>
      </Card>
    </>
  );
}
