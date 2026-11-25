import type { Unit } from '@/types';

/**
 * Display formatting. Everything user-facing is shown in India Standard Time
 * with the en-IN locale, whatever the browser's own time zone is.
 */
export const APP_TIME_ZONE = 'Asia/Kolkata';
export const APP_LOCALE = 'en-IN';
/** IST has no daylight saving, so the offset is constant. */
const IST_OFFSET = '+05:30';

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateTimeFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dateFmt = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const monthFmt = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: 'UTC', month: 'short', year: 'numeric' });
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "3 Nov 2026, 4:30 pm" (IST). */
export function formatDateTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : fallback;
}

/** "3 Nov 2026" (IST). Plain YYYY-MM-DD strings are treated as calendar dates. */
export function formatDate(value: DateInput, fallback = '—'): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00${IST_OFFSET}`);
    return dateFmt.format(d);
  }
  const d = toDate(value);
  return d ? dateFmt.format(d) : fallback;
}

/** "3 Nov" (IST). */
export function formatShortDate(value: DateInput, fallback = '—'): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return shortDateFmt.format(new Date(`${value}T12:00:00${IST_OFFSET}`));
  const d = toDate(value);
  return d ? shortDateFmt.format(d) : fallback;
}

/** "4:30 pm" (IST). */
export function formatTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : fallback;
}

/** "2026-11" → "Nov 2026". */
export function formatMonth(yyyyMm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) return yyyyMm;
  return monthFmt.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}

/** "3 Nov, 12:00 pm – 2:00 pm" or a full range across days. */
export function formatWindow(from: DateInput, to: DateInput): string {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return formatDateTime(a ?? b);
  if (istDateKey(a) === istDateKey(b)) return `${formatShortDate(a)}, ${formatTime(a)} – ${formatTime(b)}`;
  return `${formatDateTime(a)} – ${formatDateTime(b)}`;
}

/** Relative time such as "5 min ago" or "in 2 h". */
export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const d = toDate(value);
  if (!d) return '—';
  const diffSec = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(APP_LOCALE, { numeric: 'auto', style: 'short' });
  if (abs < 45) return diffSec <= 0 ? 'just now' : 'in a few seconds';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  return formatDate(d);
}

/** Calendar date key (YYYY-MM-DD) of an instant in IST. */
export function istDateKey(value: DateInput): string {
  const d = toDate(value);
  if (!d) return '';
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Value for an <input type="datetime-local"> showing the instant in IST:
 * "2026-11-03T16:30".
 */
export function toIstInputValue(value: DateInput): string {
  const d = toDate(value);
  if (!d) return '';
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Converts a datetime-local value entered in IST to ISO 8601 with the +05:30 offset. */
export function fromIstInputValue(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error(`Invalid local date-time: ${local}`);
  return `${local}:00${IST_OFFSET}`;
}

/** Parses a datetime-local IST value to epoch milliseconds (NaN when invalid). */
export function istInputToMillis(local: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return Number.NaN;
  return new Date(`${local}:00${IST_OFFSET}`).getTime();
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return istDateKey(now);
}

const inrFmt = new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFmt = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 1 });

/** "₹1,200.00" (Indian digit grouping). */
export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return inrFmt.format(amount);
}

/** "1,23,456" (Indian grouping, up to 1 decimal). */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberFmt.format(value);
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

const UNIT_WORDS: Record<Unit, [string, string]> = {
  MEALS: ['meal', 'meals'],
  PACKETS: ['packet', 'packets'],
  BOXES: ['box', 'boxes'],
};

/** "meal" / "meals", "box" / "boxes". */
export function unitLabel(unit: Unit | string, quantity: number): string {
  const words = UNIT_WORDS[unit as Unit];
  if (!words) return unit.toLowerCase();
  return quantity === 1 ? words[0] : words[1];
}

/** "1 meal", "40 meals", "1,200 boxes". */
export function formatQuantity(quantity: number | null | undefined, unit: Unit | string): string {
  if (quantity === null || quantity === undefined) return '—';
  return `${formatNumber(quantity)} ${unitLabel(unit, quantity)}`;
}

/** "850 m" / "3.7 km". */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || Number.isNaN(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${numberFmt.format(Math.round(km * 10) / 10)} km`;
}

export function formatMeters(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  return formatDistance(m / 1000);
}

/** "45 s", "12 min", "1 h 05 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "ROOM_TEMPERATURE" → "Room temperature". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
