import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge, DescriptionList } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/format';
import { ROLE_LABELS } from '../labels';
import type { AuditLogEntry } from '../types';
import { JsonBlock, ShortId } from './common';

/**
 * Audit entries as expandable rows (a grid row on desktop, a card on mobile).
 * Expanding shows the actor, request id and IP, and the changes and metadata
 * as pretty-printed JSON.
 */
export function AuditLogList({ entries }: { entries: AuditLogEntry[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="hidden grid-cols-[2rem_11rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-white/10 px-3 py-2 text-xs tracking-wide text-slate-400 uppercase md:grid" aria-hidden="true">
        <span />
        <span>Time</span>
        <span>Action</span>
        <span>Entity</span>
        <span>Actor</span>
      </div>
      <ul className="divide-y divide-white/5" aria-label="Audit log entries">
        {entries.map((e) => {
          const expanded = open.has(e.id);
          const panelId = `audit-${e.id}`;
          return (
            <li key={e.id} className={cn(expanded && 'bg-white/[0.02]')}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(e.id)}
                className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-3 text-left text-sm hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-400 md:grid-cols-[2rem_11rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center"
              >
                <span className="row-span-4 text-slate-400 md:row-span-1">
                  {expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                  <span className="sr-only">{expanded ? 'Hide details' : 'Show details'}</span>
                </span>
                <span className="text-xs text-slate-400 tabular-nums">{formatDateTime(e.occurredAt)}</span>
                <span className="font-mono text-xs break-all text-white">{e.action}</span>
                <span className="text-xs text-slate-300">
                  {e.entityType ?? '—'} {e.entityId ? <ShortId id={e.entityId} /> : null}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                  <span className="truncate text-slate-200">{e.actorEmail ?? (e.actorType === 'USER' ? 'Deleted user' : e.actorType)}</span>
                  {e.actorRole ? <Badge tone={e.actorRole === 'ADMIN' ? 'violet' : 'neutral'}>{ROLE_LABELS[e.actorRole] ?? e.actorRole}</Badge> : null}
                </span>
              </button>
              {expanded ? (
                <div id={panelId} className="space-y-4 px-3 pb-4 md:pl-14">
                  <DescriptionList
                    columns={3}
                    items={[
                      { term: 'Actor', description: e.actorEmail ?? '—' },
                      { term: 'Actor role', description: e.actorRole ? (ROLE_LABELS[e.actorRole] ?? e.actorRole) : '—' },
                      { term: 'Actor type', description: e.actorType },
                      { term: 'Request ID', description: <span className="font-mono text-xs break-all">{e.requestId ?? 'Not recorded'}</span> },
                      { term: 'IP address', description: <span className="font-mono text-xs">{e.ip ?? 'Not recorded'}</span> },
                      { term: 'Entity ID', description: <span className="font-mono text-xs break-all">{e.entityId ?? '—'}</span> },
                    ]}
                  />
                  <div className="grid gap-4 lg:grid-cols-2">
                    <JsonBlock label="Changes" value={e.changes} />
                    <JsonBlock label="Metadata" value={e.metadata} />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
