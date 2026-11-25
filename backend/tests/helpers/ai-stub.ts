import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AiClient } from '../../src/integrations/ai-client.js';
import type { AppConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';

/**
 * Minimal stand-in for the Python AI service implementing the documented
 * contract, so backend tests are deterministic and can simulate outages.
 * (The real service is exercised by tests/integration at the repository root.)
 */
export class AiStub {
  mode: 'ok' | 'down' | 'error500' = 'ok';
  /** Scripted LLM steps returned by /ai/assistant in order; empty → 503 LLM_UNAVAILABLE. */
  llmScript: Record<string, unknown>[] = [];
  readonly calls: { path: string; body: unknown; authorized: boolean }[] = [];
  private server: Server | undefined;
  url = '';

  async start(token: string): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        const authorized = req.headers.authorization === `Bearer ${token}`;
        this.calls.push({ path: req.url ?? '', body, authorized });
        if (this.mode === 'down') return req.socket.destroy();
        if (this.mode === 'error500') return send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } });
        if (!authorized) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'bad token' } });
        if (req.url === '/ai/match-ngos' || req.url === '/ai/match-donors') return send(res, 200, rank(body));
        if (req.url === '/ai/allocate-food') return send(res, 200, allocate(body));
        if (req.url === '/ai/predict-surplus') return send(res, 200, predict(body));
        if (req.url === '/ai/optimize-route') return send(res, 200, route(body));
        if (req.url === '/ai/insights') return send(res, 200, { insights: [], skipped: [{ type: 'WEEKEND_VS_WEEKDAY', reason: 'insufficient sample (n=1 < 20)' }] });
        if (req.url === '/ai/health') return send(res, 200, { status: 'ok', version: 'stub', models: { surplus_forecaster: null }, llm: { provider: 'stub', configured: true } });
        if (req.url === '/ai/assistant') {
          const next = this.llmScript.shift();
          if (!next) return send(res, 503, { error: { code: 'LLM_UNAVAILABLE', message: 'no provider' } });
          return send(res, 200, { provider: 'stub', model: 'stub-1', usage: { prompt_tokens: 10, completion_tokens: 5 }, ...next });
        }
        return send(res, 404, { error: { code: 'NOT_FOUND', message: 'no route' } });
      });
    });
    await new Promise<void>((r) => this.server?.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`;
    return this;
  }

  client(config: AppConfig): AiClient {
    return new AiClient({ ...config.ai, url: this.url, timeoutMs: 1500 }, createLogger('silent'));
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function rank(body: { candidates: { ngo_id?: string; donor_id?: string; distance_m: number; name: string }[]; weights: Record<string, number> }) {
  const results = body.candidates
    .map((c) => ({ id: (c.ngo_id ?? c.donor_id) as string, score: Math.max(0, Math.round((100 - c.distance_m / 200) * 100) / 100), c }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      candidate_id: r.id,
      rank: i + 1,
      score: r.score,
      criteria: { distance: { score: r.score, weight: 20, contribution: r.score / 5, detail: `${r.c.distance_m} m` } },
      explanation: `${r.c.name} is recommended (stub).`,
      limitations: ['Distance is a straight-line estimate, not road distance.'],
    }));
  return { algorithm_version: 'weighted-v1', weights: body.weights, results };
}

function predict(body: { history: { meal_period: string; surplus_qty: number }[]; targets: { date: string; meal_period: string }[] }) {
  return {
    model: { name: 'surplus_forecaster', version: 'stub-v1', algorithm: 'Stub', training_data_label: 'SYNTHETIC' },
    predictions: body.targets.map((t) => {
      const rows = body.history.filter((h) => h.meal_period === t.meal_period);
      if (rows.length < 14) return { date: t.date, meal_period: t.meal_period, status: 'insufficient_history', predicted_qty: null, lower_qty: null, upper_qty: null, basis: null };
      const avg = Math.round(rows.reduce((s, r) => s + r.surplus_qty, 0) / rows.length);
      return { date: t.date, meal_period: t.meal_period, status: 'ok', predicted_qty: avg, lower_qty: Math.max(0, avg - 5), upper_qty: avg + 5, basis: 'model' };
    }),
    limitations: ['Model trained on synthetic data.'],
    min_history_days: 14,
  };
}

function route(body: { locations: { id: string }[]; distance_source: string; vehicle_capacity: number }) {
  return {
    status: 'FEASIBLE',
    route: body.locations.map((l, i) => ({ location_id: l.id, sequence: i, arrival_s: i * 900, departure_s: i * 900 + 60, load_after: 0 })),
    dropped: [],
    total_distance_m: 12000,
    total_duration_s: 2700,
    distance_source: body.distance_source,
    explanation: 'stub route',
    reasons: [],
  };
}

function allocate(body: { supplies: { id: string; quantity: number }[]; demands: { id: string; quantity: number }[]; edges: { supply_id: string; demand_id: string; score: number }[] }) {
  // Highest score first, greedy (sufficient for contract tests).
  const supply = new Map(body.supplies.map((s) => [s.id, s.quantity]));
  const demand = new Map(body.demands.map((d) => [d.id, d.quantity]));
  const allocations: { supply_id: string; demand_id: string; quantity: number }[] = [];
  for (const e of [...body.edges].sort((a, b) => b.score - a.score)) {
    const q = Math.min(supply.get(e.supply_id) ?? 0, demand.get(e.demand_id) ?? 0);
    if (q > 0) {
      allocations.push({ supply_id: e.supply_id, demand_id: e.demand_id, quantity: q });
      supply.set(e.supply_id, (supply.get(e.supply_id) ?? 0) - q);
      demand.set(e.demand_id, (demand.get(e.demand_id) ?? 0) - q);
    }
  }
  return {
    status: 'OPTIMAL',
    allocations,
    total_allocated: allocations.reduce((s, a) => s + a.quantity, 0),
    unallocated_supply: [...supply].map(([id, quantity]) => ({ id, quantity })),
    unmet_demand: [...demand].map(([id, quantity]) => ({ id, quantity })),
    explanation: 'stub allocation',
    reasons: [],
  };
}
