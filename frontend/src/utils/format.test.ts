import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatINR,
  formatQuantity,
  formatTime,
  fromIstInputValue,
  istDateKey,
  toIstInputValue,
  unitLabel,
} from './format';

describe('currency (INR, en-IN grouping)', () => {
  it('formats rupees with two decimals', () => {
    expect(formatINR(200)).toBe('₹200.00');
    expect(formatINR(5)).toBe('₹5.00');
  });
  it('uses Indian digit grouping (lakhs)', () => {
    expect(formatINR(123456.5)).toBe('₹1,23,456.50');
  });
  it('shows a dash for missing values', () => {
    expect(formatINR(null)).toBe('—');
  });
});

describe('units (singular and plural)', () => {
  it.each([
    [1, 'MEALS', '1 meal'],
    [40, 'MEALS', '40 meals'],
    [1, 'PACKETS', '1 packet'],
    [30, 'PACKETS', '30 packets'],
    [1, 'BOXES', '1 box'],
    [2, 'BOXES', '2 boxes'],
    [1200, 'MEALS', '1,200 meals'],
  ] as const)('%i %s → %s', (q, unit, expected) => {
    expect(formatQuantity(q, unit)).toBe(expected);
  });
  it('labels the unit alone', () => {
    expect(unitLabel('BOXES', 1)).toBe('box');
    expect(unitLabel('BOXES', 0)).toBe('boxes');
  });
});

describe('dates in Asia/Kolkata (IST, UTC+05:30)', () => {
  it('shows instants in IST regardless of the machine time zone', () => {
    // 10:00 UTC = 15:30 IST
    expect(formatDateTime('2026-11-03T10:00:00Z').toLowerCase()).toMatch(/^3 nov 2026, 3:30\s?pm$/);
    expect(formatTime('2026-11-03T10:00:00Z').toLowerCase()).toMatch(/^3:30\s?pm$/);
  });
  it('rolls over to the next IST day after 18:30 UTC', () => {
    expect(istDateKey('2026-11-03T18:45:00Z')).toBe('2026-11-04');
    expect(formatDate('2026-11-03T18:45:00Z')).toBe('4 Nov 2026');
  });
  it('treats plain YYYY-MM-DD values as calendar dates', () => {
    expect(formatDate('2026-11-03')).toBe('3 Nov 2026');
  });
  it('converts datetime-local values entered in IST to ISO with the +05:30 offset (and back)', () => {
    expect(fromIstInputValue('2026-11-03T16:30')).toBe('2026-11-03T16:30:00+05:30');
    expect(toIstInputValue('2026-11-03T11:00:00Z')).toBe('2026-11-03T16:30');
    expect(toIstInputValue(fromIstInputValue('2026-12-31T23:59'))).toBe('2026-12-31T23:59');
  });
  it('rejects malformed datetime-local values', () => {
    expect(() => fromIstInputValue('03/11/2026 16:30')).toThrow();
  });
});

describe('distance and duration', () => {
  it('formats metres and kilometres', () => {
    expect(formatDistance(0.85)).toBe('850 m');
    expect(formatDistance(3.72)).toBe('3.7 km');
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(720)).toBe('12 min');
    expect(formatDuration(3900)).toBe('1 h 05 min');
    expect(formatDuration(null)).toBe('—');
  });
});
