const DEFAULT_TZ = process.env.DEFAULT_DISPLAY_TIMEZONE ?? 'Asia/Kolkata';

/** Human-readable local date-time for notification text (timestamps are stored in UTC). */
export function formatDateTime(date: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatTime(date: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(date: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Minutes since local midnight and ISO weekday (1 = Monday) of an instant in a timezone. */
export function localClock(date: Date, timeZone = DEFAULT_TZ): { minutes: number; isoWeekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { minutes: Number(get('hour')) * 60 + Number(get('minute')), isoWeekday: weekday };
}

export function unitLabel(unit: string, quantity: number): string {
  const u = unit.toLowerCase();
  return quantity === 1 ? u.replace(/s$/, '') : u;
}
