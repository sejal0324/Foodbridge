import { describe, expect, it } from 'vitest';
import { INDIA_BOUNDS, INDIA_CENTER, INDIA_DEFAULT_ZOOM, INDIA_STATES_AND_UTS, INDIAN_STATES, INDIAN_UNION_TERRITORIES, isWithinIndiaBounds, matchIndianState } from './india';

describe('India reference data', () => {
  it('lists 28 states and 8 union territories, without duplicates', () => {
    expect(INDIAN_STATES).toHaveLength(28);
    expect(INDIAN_UNION_TERRITORIES).toHaveLength(8);
    expect(new Set(INDIA_STATES_AND_UTS).size).toBe(36);
    expect(INDIA_STATES_AND_UTS).toContain('Ladakh');
    expect(INDIA_STATES_AND_UTS).toContain('Telangana');
  });

  it('normalises geocoder state names to the official list', () => {
    expect(matchIndianState('maharashtra')).toBe('Maharashtra');
    expect(matchIndianState('  TAMIL   NADU ')).toBe('Tamil Nadu');
    expect(matchIndianState('Orissa')).toBe('Odisha');
    expect(matchIndianState('NCT of Delhi')).toBe('Delhi');
    expect(matchIndianState('Jammu & Kashmir')).toBe('Jammu and Kashmir');
    expect(matchIndianState('Daman and Diu')).toBe('Dadra and Nagar Haveli and Daman and Diu');
    expect(matchIndianState('Bavaria')).toBeNull();
    expect(matchIndianState(null)).toBeNull();
  });

  it('centres maps on India (not a single city) and bounds them to India', () => {
    expect(INDIA_CENTER).toEqual({ lat: 22.5, lng: 80.0 });
    expect(INDIA_DEFAULT_ZOOM).toBe(5);
    expect(INDIA_BOUNDS).toEqual([
      [5.5, 67.5],
      [37.8, 98.0],
    ]);
    expect(isWithinIndiaBounds({ lat: 28.61, lng: 77.21 })).toBe(true); // Delhi
    expect(isWithinIndiaBounds({ lat: 8.08, lng: 77.54 })).toBe(true); // Kanyakumari
    expect(isWithinIndiaBounds({ lat: 51.5, lng: -0.12 })).toBe(false); // London
  });
});
