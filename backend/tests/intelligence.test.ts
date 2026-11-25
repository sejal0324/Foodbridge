import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiStub } from './helpers/ai-stub.js';
import { approvedPair } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { createDonation, inMinutes, requestDonation } from './helpers/workflow.js';

let h: Harness;
const stub = new AiStub();
beforeAll(async () => {
  await stub.start(process.env.INTERNAL_SERVICE_TOKEN as string);
  h = await createHarness((c) => ({ ...c, ai: { ...c.ai, url: stub.url, timeoutMs: 1500 } }));
});
beforeEach(async () => {
  stub.mode = 'ok';
  stub.llmScript = [];
  stub.calls.length = 0;
  await resetDatabase(h.ctx.db);
});
afterAll(async () => {
  await stub.stop();
  await h.close();
});

describe('surplus forecasting', () => {
  it('stores donor metrics, forecasts with the model version and labels synthetic history', async () => {
    const { donor } = await approvedPair(h);
    await h.http.post('/api/donors/me/metrics').set(donor.auth).send({ date: '2026-10-01', mealPeriod: 'LUNCH', preparedQty: 200, soldQty: 180, surplusQty: 20 }).expect(200);
    await h.http.post('/api/donors/me/metrics').set(donor.auth).send({ date: '2026-10-02', mealPeriod: 'LUNCH', preparedQty: 100, soldQty: 120, surplusQty: 0 }).expect(422);
    const few = await h.http.get('/api/predictions/surplus').set(donor.auth).expect(200);
    expect(few.body.data.predictions.every((p: { status: string; predictedQuantity: unknown }) => p.status === 'INSUFFICIENT_HISTORY' && p.predictedQuantity === null)).toBe(true);
    await h.ctx.db.query(
      `INSERT INTO restaurant_daily_metrics (donor_id, metric_date, meal_period, prepared_qty, sold_qty, surplus_qty, data_source)
       SELECT $1, current_date - g, mp, 200, 170, 30, 'SYNTHETIC' FROM generate_series(1, 30) g, unnest(ARRAY['LUNCH','DINNER']) mp`,
      [donor.orgId],
    );
    const res = await h.http.get('/api/predictions/surplus').set(donor.auth).expect(200);
    expect(res.body.data).toMatchObject({ status: 'OK', dataLabel: 'MIXED', model: { version: 'stub-v1', trainingDataLabel: 'SYNTHETIC' } });
    expect(res.body.data.predictions.some((p: { predictedQuantity: number | null }) => typeof p.predictedQuantity === 'number')).toBe(true);
    expect(res.body.data.notice).toMatch(/not a donation/);
    const stored = await h.ctx.db.query(`SELECT count(*) AS n FROM surplus_predictions WHERE status = 'OK'`);
    expect(stored.rows[0]?.n).toBeGreaterThan(0);
    const model = await h.ctx.db.query(`SELECT version, is_active FROM model_versions`);
    expect(model.rows).toEqual([{ version: 'stub-v1', is_active: true }]);
    // No donation was created from a prediction.
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM donations')).rows[0]?.n).toBe(0);
  });

  it('marks the forecast unavailable (never guesses) when the AI service is down', async () => {
    const { donor } = await approvedPair(h);
    stub.mode = 'down';
    const res = await h.http.get('/api/predictions/surplus').set(donor.auth).expect(200);
    expect(res.body.data).toMatchObject({ status: 'UNAVAILABLE', predictions: [] });
  });
});

describe('collection route planning', () => {
  it('builds a plan from reserved allocations with labelled estimated travel times, and reports when the optimiser is down', async () => {
    const { donor, ngo, cooked } = await approvedPair(h);
    const d = await createDonation(h, donor, cooked, { pickupAvailableFrom: inMinutes(0) });
    const rid = await requestDonation(h, ngo, d.id, 30);
    const { body } = await h.http.patch(`/api/requests/${rid}/approve`).set(donor.auth).send({}).expect(200);
    const plan = await h.http
      .post('/api/collection-plans')
      .set(ngo.auth)
      .send({ planDate: new Date().toISOString().slice(0, 10), startTime: inMinutes(10), vehicleCapacity: 100, allocationIds: [body.data.allocationId] })
      .expect(201);
    expect(plan.body.data).toMatchObject({ solverStatus: 'FEASIBLE', distanceSource: 'STRAIGHT_LINE_ESTIMATE' });
    expect(plan.body.data.explanation).toMatch(/estimates/);
    expect(plan.body.data.stops.filter((s: { type: string }) => s.type === 'PICKUP')[0].plannedArrivalAt).toBeTruthy();
    const call = stub.calls.find((c) => c.path === '/ai/optimize-route')?.body as { duration_matrix_s: number[][]; vehicle_capacity: number };
    expect(call.vehicle_capacity).toBe(100);
    expect(call.duration_matrix_s.length).toBe(3);

    stub.mode = 'down';
    const down = await h.http
      .post('/api/collection-plans')
      .set(ngo.auth)
      .send({ planDate: new Date().toISOString().slice(0, 10), startTime: inMinutes(10), vehicleCapacity: 100, allocationIds: [body.data.allocationId] })
      .expect(201);
    expect(down.body.data.solverStatus).toBe('UNAVAILABLE');
    await h.http.post('/api/collection-plans').set(donor.auth).send({}).expect(403);
  });
});

describe('analytics and insights', () => {
  it('serves role analytics from stored data and public aggregate impact', async () => {
    const { admin, donor, ngo } = await approvedPair(h);
    const donorStats = await h.http.get('/api/analytics/donor').set(donor.auth).expect(200);
    expect(donorStats.body.data).toMatchObject({ totals: { donations: 0 }, dataLabel: 'REAL' });
    expect(donorStats.body.data.monthly).toHaveLength(12);
    await h.http.get('/api/analytics/ngo').set(ngo.auth).expect(200);
    await h.http.get('/api/analytics/admin').set(donor.auth).expect(403);
    const adminStats = await h.http.get('/api/analytics/admin').set(admin.auth).expect(200);
    expect(adminStats.body.data.platform).toMatchObject({ verifiedDonors: 1, verifiedNgos: 1 });
    const impact = await h.http.get('/api/public/impact').expect(200);
    expect(impact.body.data).toMatchObject({ mealsRedistributed: 0, verifiedDonors: 1 });
    const insights = await h.http.get('/api/analytics/insights').set(admin.auth).expect(200);
    expect(insights.body.data.skipped[0].reason).toMatch(/insufficient sample/);
    stub.mode = 'down';
    const unavailable = await h.http.get('/api/analytics/insights').set(admin.auth).expect(200);
    expect(unavailable.body.data.status).toBe('UNAVAILABLE');
  });
});

describe('AI assistant: authorised tools, confirmation, fallback', () => {
  it('executes LLM-requested tools as the user and answers from tool results', async () => {
    const { donor, cooked } = await approvedPair(h);
    await createDonation(h, donor, cooked, { foodName: 'Lemon rice' });
    stub.llmScript = [
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'search_donations', arguments: {} }] },
      { type: 'message', content: 'You have 1 donation: Lemon rice (100 meals).' },
    ];
    const res = await h.http.post('/api/ai/chat').set(donor.auth).send({ message: 'Show my donations' }).expect(200);
    expect(res.body.data).toMatchObject({ mode: 'LLM', message: 'You have 1 donation: Lemon rice (100 meals).' });
    expect(res.body.data.cards[0].tool).toBe('search_donations');
    expect(res.body.data.cards[0].data[0].foodName).toBe('Lemon rice');
    // The second LLM step received the tool result, and no tool beyond the donor's role was offered.
    const steps = stub.calls.filter((c) => c.path === '/ai/assistant').map((c) => c.body as { messages: { role: string }[]; tools: { name: string }[] });
    expect(steps[1]?.messages.some((m) => m.role === 'tool')).toBe(true);
    expect(steps[0]?.tools.map((t) => t.name)).not.toContain('get_pending_verifications');
    expect(steps[0]?.tools.map((t) => t.name)).not.toContain('create_assistance_request');
  });

  it('refuses tools outside the user\'s role even if the LLM asks for them', async () => {
    const { donor } = await approvedPair(h);
    stub.llmScript = [
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'get_pending_verifications', arguments: {} }] },
      { type: 'message', content: 'I cannot access that.' },
    ];
    const res = await h.http.post('/api/ai/chat').set(donor.auth).send({ message: 'Show pending verification applications' }).expect(200);
    expect(res.body.data.cards).toHaveLength(0);
    const toolRow = await h.ctx.db.query(`SELECT tool_result_summary FROM ai_interactions WHERE role = 'TOOL'`);
    expect(JSON.stringify(toolRow.rows[0]?.tool_result_summary)).toMatch(/not available for this user/);
  });

  it('never executes a state change without explicit user confirmation', async () => {
    const { ngo } = await approvedPair(h);
    const from = new Date(Date.now() + 26 * 3_600_000).toISOString();
    const until = new Date(Date.now() + 28 * 3_600_000).toISOString();
    stub.llmScript = [
      {
        type: 'tool_calls',
        calls: [{ id: 'c1', name: 'create_assistance_request', arguments: { categoryCode: 'COOKED_MEALS', dietaryRequirement: 'VEG_ONLY', quantityRequired: 100, unit: 'MEALS', neededFrom: from, neededUntil: until, urgency: 'MEDIUM', beneficiariesCount: 100 } }],
      },
      { type: 'message', content: 'I drafted the request; please confirm it.' },
    ];
    const res = await h.http.post('/api/ai/chat').set(ngo.auth).send({ message: 'I need 100 meals tomorrow' }).expect(200);
    expect(res.body.data.pendingAction.summary).toMatch(/100 meals/);
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM food_assistance_requests')).rows[0]?.n).toBe(0);
    const created = await h.http.post(`/api/ai/actions/${res.body.data.pendingAction.id}/confirm`).set(ngo.auth).send({}).expect(201);
    expect(created.body.data).toMatchObject({ quantityRequired: 100, status: 'OPEN' });
    await h.http.post(`/api/ai/actions/${res.body.data.pendingAction.id}/confirm`).set(ngo.auth).send({}).expect(409);
  });

  it('does not let an NGO that is no longer approved publish a request through the assistant', async () => {
    const { ngo } = await approvedPair(h);
    const from = new Date(Date.now() + 26 * 3_600_000).toISOString();
    const until = new Date(Date.now() + 28 * 3_600_000).toISOString();
    stub.llmScript = [
      {
        type: 'tool_calls',
        calls: [{ id: 'c1', name: 'create_assistance_request', arguments: { categoryCode: 'COOKED_MEALS', dietaryRequirement: 'VEG_ONLY', quantityRequired: 50, unit: 'MEALS', neededFrom: from, neededUntil: until, urgency: 'MEDIUM', beneficiariesCount: 50 } }],
      },
      { type: 'message', content: 'Drafted; please confirm.' },
    ];
    const res = await h.http.post('/api/ai/chat').set(ngo.auth).send({ message: 'I need 50 meals tomorrow' }).expect(200);
    expect(res.body.data.pendingAction).toBeTruthy();
    await h.ctx.db.query(`UPDATE ngos SET verification_status = 'SUSPENDED' WHERE id = $1`, [ngo.orgId]);
    const denied = await h.http.post(`/api/ai/actions/${res.body.data.pendingAction.id}/confirm`).set(ngo.auth).send({}).expect(403);
    expect(denied.body.error.code).toBe('ORGANISATION_NOT_APPROVED');
    expect((await h.ctx.db.query('SELECT count(*) AS n FROM food_assistance_requests')).rows[0]?.n).toBe(0);
  });

  it('falls back to direct, real results when the LLM is unavailable', async () => {
    const { donor } = await approvedPair(h);
    const res = await h.http.post('/api/ai/chat').set(donor.auth).send({ message: 'How many reward points have I earned?' }).expect(200);
    expect(res.body.data).toMatchObject({ mode: 'FALLBACK' });
    expect(res.body.data.cards[0]).toMatchObject({ tool: 'get_reward_balance', data: { balance: 0 } });
    const chip = await h.http.post('/api/ai/chat').set(donor.auth).send({ message: 'Show my donations this month', intent: 'get_donor_analytics' }).expect(200);
    expect(chip.body.data.mode).toBe('DIRECT');
    await h.http.post('/api/ai/chat').set(donor.auth).send({ message: 'x', intent: 'get_pending_verifications' }).expect(403);
    const nothing = await h.http.post('/api/ai/chat').set(donor.auth).send({ message: 'Tell me a joke' }).expect(200);
    expect(nothing.body.data.mode).toBe('UNAVAILABLE');
  });
});
