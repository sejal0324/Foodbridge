import { describe, expect, it } from 'vitest';
import { cityMarkers, describeRewardRules, isOverdue, markerLabel, outstandingOf } from './helpers';
import { rewardAdjustSchema, rewardRuleSchema } from './schemas';
import { numberSettingError, weightError, weightsSum } from './settings';
import type { RewardRuleRow } from './types';

const rule = (r: Partial<RewardRuleRow>): RewardRuleRow => ({
  id: Math.random().toString(36),
  unit: 'MEALS',
  basis: 'PER_UNIT',
  points: 10,
  lifetimeThreshold: 0,
  description: null,
  effectiveFrom: '2026-11-03T00:00:00Z',
  effectiveTo: null,
  isActive: true,
  ...r,
});

describe('admin helpers', () => {
  it('describes the reward rules in plain language', () => {
    const lines = describeRewardRules([
      rule({ unit: 'MEALS', points: 10, lifetimeThreshold: 0 }),
      rule({ unit: 'MEALS', points: 15, lifetimeThreshold: 500 }),
      rule({ unit: 'MEALS', points: 8, lifetimeThreshold: 0, isActive: false }),
      rule({ unit: 'PACKETS', basis: 'PER_ORDER', points: 10 }),
      rule({ unit: 'BOXES', basis: 'PER_ORDER', points: 10 }),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Meals: 10 points per meal from the first meal, then 15 points per meal after 500 lifetime meals.',
      'Packets: 10 points per verified order, whatever the number of packets.',
      'Boxes: 10 points per verified order, whatever the number of boxes.',
    ]);
    expect(describeRewardRules([])[0]?.text).toBe('Meals: no active rule, so no points are earned.');
  });

  it('labels city markers by donation count and skips cities without coordinates', () => {
    expect(markerLabel(7)).toBe('7');
    expect(markerLabel(150)).toBe('99+');
    const markers = cityMarkers([
      { city: 'Pune', donations: 5, quantity: 335, lat: 18.58, lng: 73.76 },
      { city: 'Unknown', donations: 1, quantity: 10, lat: null, lng: null },
    ]);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ label: '5', position: { lat: 18.58, lng: 73.76 }, title: 'Pune: 5 donations, 335 units listed' });
  });

  it('flags pickups past the deadline that were never handed over', () => {
    const now = Date.parse('2026-11-03T15:00:00Z');
    const p = (status: string, deadline: string) => ({ status, donation: { pickupDeadline: deadline } }) as Parameters<typeof isOverdue>[0];
    expect(isOverdue(p('ASSIGNED', '2026-11-03T14:00:00Z'), now)).toBe(true);
    expect(isOverdue(p('VERIFIED', '2026-11-03T14:00:00Z'), now)).toBe(true);
    expect(isOverdue(p('ASSIGNED', '2026-11-03T16:00:00Z'), now)).toBe(false);
    expect(isOverdue(p('DELIVERED', '2026-11-03T14:00:00Z'), now)).toBe(false);
  });

  it('computes the outstanding invoice amount in paise precision', () => {
    expect(outstandingOf({ total: 300, amountPaid: 100.1 })).toBe(199.9);
    expect(outstandingOf({ total: 300, amountPaid: 300 })).toBe(0);
  });

  it('validates setting inputs like SETTING_SCHEMAS', () => {
    expect(weightsSum({ distance: '20', food_requirement: '20.5', quantity_capacity: '15' })).toBe(55.5);
    expect(weightError('')).toBe('Enter a weight');
    expect(weightError('101')).toBe('At most 100');
    expect(weightError('-1')).toBe('Use a number from 0 to 100');
    expect(numberSettingError({ min: 0, max: 100, integer: false, exclusiveMin: true }, '0')).toBe('Must be greater than 0');
    expect(numberSettingError({ min: 1, max: 90, integer: true }, '2.5')).toBe('Use a whole number');
    expect(numberSettingError({ min: 1, max: 90, integer: true }, '30')).toBeNull();
  });

  it('validates reward rules and adjustments like the backend', () => {
    expect(rewardRuleSchema.safeParse({ unit: 'PACKETS', basis: 'PER_ORDER', points: '10', lifetimeThreshold: '5', description: '' }).success).toBe(false);
    expect(rewardRuleSchema.safeParse({ unit: 'MEALS', basis: 'PER_UNIT', points: '15', lifetimeThreshold: '500', description: '' }).success).toBe(true);
    expect(rewardRuleSchema.safeParse({ unit: 'MEALS', basis: 'PER_UNIT', points: '0', lifetimeThreshold: '0', description: '' }).success).toBe(false);
    expect(rewardAdjustSchema.safeParse({ donorId: 'd1', points: '0', reason: 'Fix' }).success).toBe(false);
    expect(rewardAdjustSchema.safeParse({ donorId: 'd1', points: '-50', reason: 'Duplicate credit' }).success).toBe(true);
    expect(rewardAdjustSchema.safeParse({ donorId: '', points: '50', reason: 'Bonus' }).success).toBe(false);
  });
});
