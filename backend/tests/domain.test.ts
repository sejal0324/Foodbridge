import { describe, expect, it } from 'vitest';
import { calculateServiceFee } from '../src/domain/fees.js';
import { calculateRewardPoints, tierFor, type RewardRule } from '../src/domain/rewards.js';
import { assertTransition, canTransition, donationStatusFromQuantities, requestStatusFromQuantities } from '../src/domain/state-machines.js';

// Mirrors the rules seeded by migration 0009 (confirmed business rules).
const RULES: RewardRule[] = [
  { id: 'meals-base', unit: 'MEALS', basis: 'PER_UNIT', points: 10, lifetimeThreshold: 0 },
  { id: 'meals-500', unit: 'MEALS', basis: 'PER_UNIT', points: 15, lifetimeThreshold: 500 },
  { id: 'packets', unit: 'PACKETS', basis: 'PER_ORDER', points: 10, lifetimeThreshold: 0 },
  { id: 'boxes', unit: 'BOXES', basis: 'PER_ORDER', points: 10, lifetimeThreshold: 0 },
];

describe('reward calculation (10/meal, 15/meal after 500 lifetime meals, 10/order for packets & boxes)', () => {
  const meals = (quantity: number, lifetimeQuantityBefore = 0) =>
    calculateRewardPoints({ unit: 'MEALS', quantity, lifetimeQuantityBefore, rules: RULES }).points;

  it('awards 10 points per meal below the threshold', () => {
    expect(meals(1)).toBe(10);
    expect(meals(7)).toBe(70);
    expect(meals(10)).toBe(100);
    expect(meals(40)).toBe(400);
  });

  it('awards 15 points per meal after 500 lifetime meals', () => {
    expect(meals(10, 500)).toBe(150);
    expect(meals(100, 1200)).toBe(1500);
  });

  it('splits a handover that crosses the 500-meal boundary', () => {
    const calc = calculateRewardPoints({ unit: 'MEALS', quantity: 40, lifetimeQuantityBefore: 480, rules: RULES });
    expect(calc.points).toBe(20 * 10 + 20 * 15);
    expect(calc.lines.map((l) => [l.units, l.pointsPerUnit])).toEqual([
      [20, 10],
      [20, 15],
    ]);
    expect(meals(1, 499)).toBe(10);
    expect(meals(1, 500)).toBe(15);
    expect(meals(600)).toBe(500 * 10 + 100 * 15);
  });

  it('awards a flat 10 points per verified packet or box order regardless of count', () => {
    expect(calculateRewardPoints({ unit: 'PACKETS', quantity: 1, lifetimeQuantityBefore: 0, rules: RULES }).points).toBe(10);
    expect(calculateRewardPoints({ unit: 'PACKETS', quantity: 250, lifetimeQuantityBefore: 900, rules: RULES }).points).toBe(10);
    expect(calculateRewardPoints({ unit: 'BOXES', quantity: 3, lifetimeQuantityBefore: 0, rules: RULES }).points).toBe(10);
  });

  it('awards nothing for a zero quantity and rejects fractional quantities', () => {
    expect(meals(0)).toBe(0);
    expect(() => meals(2.5)).toThrow();
  });

  it('picks reward tiers from lifetime points', () => {
    const tiers = [
      { name: 'BRONZE', minLifetimePoints: 0 },
      { name: 'SILVER', minLifetimePoints: 2000 },
      { name: 'GOLD', minLifetimePoints: 10000 },
    ];
    expect(tierFor(0, tiers).current?.name).toBe('BRONZE');
    expect(tierFor(2500, tiers)).toMatchObject({ current: { name: 'SILVER' }, next: { name: 'GOLD' } });
    expect(tierFor(20000, tiers).next).toBeNull();
  });
});

describe('NGO service fee (₹5 per unit, tax configurable and separate)', () => {
  const noTax = { enabled: false, name: 'GST', ratePercent: 18 };

  it('charges ₹5 per meal on the verified quantity: 40 meals = ₹200 base', () => {
    const fee = calculateServiceFee({ unit: 'MEALS', quantity: 40, amountPerUnit: 5, currency: 'INR', tax: noTax });
    expect(fee).toMatchObject({ baseAmount: 200, totalAmount: 200, tax: { applied: false, amount: 0 } });
  });

  it('charges ₹5 per packet or box', () => {
    expect(calculateServiceFee({ unit: 'PACKETS', quantity: 12, amountPerUnit: 5, currency: 'INR', tax: noTax }).totalAmount).toBe(60);
    expect(calculateServiceFee({ unit: 'BOXES', quantity: 3, amountPerUnit: 5, currency: 'INR', tax: noTax }).totalAmount).toBe(15);
  });

  it('applies tax separately only when enabled, rounding to the paisa', () => {
    const fee = calculateServiceFee({ unit: 'MEALS', quantity: 40, amountPerUnit: 5, currency: 'INR', tax: { enabled: true, name: 'GST', ratePercent: 18 } });
    expect(fee).toMatchObject({ baseAmount: 200, tax: { applied: true, name: 'GST', amount: 36 }, totalAmount: 236 });
    const odd = calculateServiceFee({ unit: 'MEALS', quantity: 3, amountPerUnit: 5, currency: 'INR', tax: { enabled: true, name: 'GST', ratePercent: 18 } });
    expect(odd.tax.amount).toBe(2.7);
    expect(odd.totalAmount).toBe(17.7);
  });
});

describe('state machines', () => {
  it('allows documented transitions and rejects others with 409', () => {
    expect(canTransition('donation', 'AVAILABLE', 'PARTIALLY_RESERVED')).toBe(true);
    expect(canTransition('donation', 'COMPLETED', 'AVAILABLE')).toBe(false);
    expect(() => assertTransition('offer', 'REJECTED', 'ACCEPTED')).toThrow(/Cannot change offer status/);
    expect(() => assertTransition('allocation', 'RESERVED', 'COMPLETED')).toThrow();
  });

  it('derives reservation and fulfilment statuses from quantities', () => {
    expect(donationStatusFromQuantities(100, 0)).toBe('AVAILABLE');
    expect(donationStatusFromQuantities(100, 40)).toBe('PARTIALLY_RESERVED');
    expect(donationStatusFromQuantities(100, 100)).toBe('RESERVED');
    expect(requestStatusFromQuantities(150, 0)).toBe('OPEN');
    expect(requestStatusFromQuantities(150, 110)).toBe('PARTIALLY_FULFILLED');
    expect(requestStatusFromQuantities(150, 150)).toBe('FULFILLED');
  });
});
