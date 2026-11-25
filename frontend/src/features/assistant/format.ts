import { formatDateTime, formatNumber, humanize } from '@/utils/format';

export function formatScalarForAction(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v);
  if (typeof v === 'string' && /^[A-Z][A-Z_]+$/.test(v)) return humanize(v);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
