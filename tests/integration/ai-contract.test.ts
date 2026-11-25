import { describe, expect, it } from 'vitest';
import { AI, ai } from './helpers.js';

/** The real Python AI service accepts exactly what the backend sends (contract, no mocks). */
describe('AI service contract (real service)', () => {
  it('reports health and requires the internal token', async () => {
    const health = await (await fetch(`${AI}/ai/health`)).json();
    expect(health.models.surplus_forecaster.training_data_label).toBe('SYNTHETIC');
    const unauth = await fetch(`${AI}/ai/match-ngos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(unauth.status).toBe(401);
  });

  it('ranks NGOs with per-criterion explanations exactly as the backend payload is shaped', async () => {
    const weights = { distance: 20, food_requirement: 20, quantity_capacity: 15, food_preference: 10, urgency: 15, pickup_availability: 10, reliability: 5, beneficiary_demand: 5 };
    const r = await ai('/ai/match-ngos', {
      donation: { id: '00000000-0000-4000-8000-000000000001', category_code: 'COOKED_MEALS', dietary_type: 'VEG', quantity_available: 120, unit: 'MEALS', storage_type: 'HOT_HELD', requires_refrigeration: false, minutes_until_deadline: 240 },
      weights,
      candidates: [
        { ngo_id: '00000000-0000-4000-8000-0000000000a1', name: 'Near NGO', distance_m: 900, distance_source: 'STRAIGHT_LINE_ESTIMATE', travel_time_s: null, collection_radius_m: 10000, capacity_remaining: 200, open_need: { quantity_remaining: 100, urgency: 'HIGH', dietary_requirement: 'VEG_ONLY' }, has_refrigeration: false, accepts_veg: true, accepts_non_veg: false, reliability: { completed: 10, failed: 0 }, beneficiaries_count: 150 },
        { ngo_id: '00000000-0000-4000-8000-0000000000a2', name: 'Far NGO', distance_m: 9000, distance_source: 'STRAIGHT_LINE_ESTIMATE', travel_time_s: null, collection_radius_m: 10000, capacity_remaining: 20, open_need: null, has_refrigeration: false, accepts_veg: true, accepts_non_veg: true, reliability: { completed: 0, failed: 0 }, beneficiaries_count: 40 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.results[0].candidate_id).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(Object.keys(r.body.results[0].criteria).sort()).toEqual(Object.keys(weights).sort());
    expect(r.body.results[1].limitations.join(' ')).toMatch(/limited history|straight-line/i);
  });

  it('allocates integer quantities without exceeding supply or demand', async () => {
    const r = await ai('/ai/allocate-food', {
      supplies: [{ id: 's1', quantity: 100 }],
      demands: [{ id: 'd1', quantity: 20, min_quantity: 1 }, { id: 'd2', quantity: 50, min_quantity: 1 }, { id: 'd3', quantity: 60, min_quantity: 1 }],
      edges: [{ supply_id: 's1', demand_id: 'd1', score: 70, max_quantity: null }, { supply_id: 's1', demand_id: 'd2', score: 90, max_quantity: null }, { supply_id: 's1', demand_id: 'd3', score: 60, max_quantity: null }],
      time_limit_s: 5,
    });
    expect(r.status).toBe(200);
    expect(r.body.total_allocated).toBe(100);
    for (const a of r.body.allocations) expect(Number.isInteger(a.quantity)).toBe(true);
  });

  it('forecasts from history and refuses to guess without enough history', async () => {
    const history = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 1 + i));
      return { date: d.toISOString().slice(0, 10), meal_period: 'LUNCH', prepared_qty: 200, sold_qty: 170, surplus_qty: 30, is_holiday: false, special_event: null };
    });
    const ok = await ai('/ai/predict-surplus', { donor_id: '00000000-0000-4000-8000-000000000009', unit: 'MEALS', history, targets: [{ date: '2026-10-12', meal_period: 'LUNCH', is_holiday: false, special_event: null, planned_prepared_qty: null }] });
    expect(ok.status).toBe(200);
    expect(ok.body.predictions[0].status).toBe('ok');
    expect(ok.body.predictions[0].predicted_qty).toBeGreaterThanOrEqual(0);
    const few = await ai('/ai/predict-surplus', { donor_id: '00000000-0000-4000-8000-000000000009', unit: 'MEALS', history: history.slice(0, 5), targets: [{ date: '2026-10-12', meal_period: 'LUNCH', is_holiday: false, special_event: null, planned_prepared_qty: null }] });
    expect(few.body.predictions[0]).toMatchObject({ status: 'insufficient_history', predicted_qty: null });
  });

  it('returns 503 for the assistant when no LLM provider is configured', async () => {
    const r = await ai('/ai/assistant', { messages: [{ role: 'user', content: 'hi' }], tools: [], temperature: 0.2 });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('LLM_UNAVAILABLE');
  });
});
