import { ArrowRight, ChevronLeft, ChevronRight, Database } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Checkbox, ConfirmDialog, Field, Textarea } from '@/components/ui';
import type { DataLabel } from '@/types';
import { cn } from '@/utils/cn';

/** One row of filters above a list. Wraps on small screens. */
export function FilterBar({ children, onReset, active, className }: { children: ReactNode; onReset?: () => void; active?: boolean; className?: string }) {
  return (
    <div role="group" aria-label="Filters" className={cn('flex flex-wrap items-end gap-3', className)}>
      {children}
      {active && onReset ? (
        <Button variant="ghost" size="sm" onClick={onReset} className="mb-0.5">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/** Pretty-printed JSON (audit changes, metadata, unknown settings). */
export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const text = value === null || value === undefined ? 'null' : JSON.stringify(value, null, 2);
  return (
    <div>
      <p className="mb-1 text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <pre aria-label={label} className="max-h-80 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-slate-200">
        {text}
      </pre>
    </div>
  );
}

/** Previous / next paging for endpoints that do not return a total. */
export function SimplePager({ page, hasNext, onPageChange, className }: { page: number; hasNext: boolean; onPageChange: (page: number) => void; className?: string }) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-end gap-2 text-sm text-slate-400', className)}>
      <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} leftIcon={<ChevronLeft className="size-4" aria-hidden="true" />}>
        Previous
      </Button>
      <span aria-current="page" className="px-1 tabular-nums">
        Page {page}
      </span>
      <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={!hasNext} rightIcon={<ChevronRight className="size-4" aria-hidden="true" />}>
        Next
      </Button>
    </nav>
  );
}

/** "Demo data" pill for analytics computed from a database that contains seeded demo records. */
export function DataLabelBadge({ label }: { label: DataLabel | undefined }) {
  if (!label || label === 'REAL') return null;
  return (
    <Badge tone="violet" icon={<Database className="size-3" aria-hidden="true" />} title={`Dataset label: ${label}`}>
      {label === 'SYNTHETIC' ? 'Synthetic data' : 'Demo data'}
    </Badge>
  );
}

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:underline">
      {children} <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

/** Short id for display ("a1b2c3d4…"); the full id stays available as a title. */
export function ShortId({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-slate-500">—</span>;
  return (
    <span title={id} className="font-mono text-xs text-slate-300">
      {id.slice(0, 8)}…
    </span>
  );
}

/**
 * Strong confirmation for irreversible admin actions: a reason (min 3
 * characters, as the API requires) and an explicit acknowledgement.
 */
export function StrongCancelDialog({
  open,
  title,
  description,
  consequences,
  acknowledgement,
  confirmLabel,
  reasonHint,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  consequences?: ReactNode;
  acknowledgement: string;
  confirmLabel: string;
  reasonHint: string;
  loading: boolean;
  onClose: () => void;
  /** Resolve true on success (the dialog closes), false when the action failed (it stays open). */
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const close = () => {
    setReason('');
    setAck(false);
    onClose();
  };
  return (
    <ConfirmDialog
      open={open}
      onClose={close}
      tone="danger"
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel="Keep it"
      confirmDisabled={reason.trim().length < 3 || !ack}
      loading={loading}
      onConfirm={() => onConfirm(reason.trim()).then((done) => (done ? close() : undefined))}
    >
      <div className="space-y-4">
        {consequences}
        <Field label="Reason" hint={reasonHint} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
        </Field>
        <Checkbox label={acknowledgement} checked={ack} onChange={(e) => setAck(e.target.checked)} />
      </div>
    </ConfirmDialog>
  );
}
