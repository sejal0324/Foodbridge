import { Badge } from './Badge';
import { statusStyle } from './status';

/** Coloured badge for any backend status value (see STATUS_STYLES). */
export function StatusBadge({ status, className, label }: { status: string | null | undefined; className?: string; label?: string }) {
  const s = statusStyle(status);
  return (
    <Badge tone={s.tone} dot className={className}>
      <span data-status={status ?? ''}>{label ?? s.label}</span>
    </Badge>
  );
}
