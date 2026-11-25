import type { AppConfig } from '../config/env.js';
import type { Logger } from '../config/logger.js';

/** The AI service could not be reached, timed out, or failed (5xx). Callers degrade gracefully. */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'AI_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** The AI service rejected the request (4xx) — a contract or input problem, not an outage. */
export class AiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

export interface CriterionScore {
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface RankedResult {
  candidate_id: string;
  rank: number;
  score: number;
  criteria: Record<string, CriterionScore>;
  explanation: string;
  limitations: string[];
}

export interface MatchResponse {
  algorithm_version: string;
  weights: Record<string, number>;
  results: RankedResult[];
}

export interface SurplusPrediction {
  date: string;
  meal_period: string;
  status: 'ok' | 'insufficient_history';
  predicted_qty: number | null;
  lower_qty: number | null;
  upper_qty: number | null;
  basis: string | null;
}

export interface PredictResponse {
  model: { name: string; version: string; algorithm: string; training_data_label: string };
  predictions: SurplusPrediction[];
  limitations: string[];
  min_history_days: number;
}

export interface AllocateResponse {
  status: string;
  allocations: { supply_id: string; demand_id: string; quantity: number }[];
  total_allocated: number;
  unallocated_supply: { id: string; quantity: number }[];
  unmet_demand: { id: string; quantity: number }[];
  explanation: string;
  reasons: string[];
}

export interface RouteResponse {
  status: string;
  route: { location_id: string; sequence: number; arrival_s: number; departure_s: number; load_after: number }[];
  dropped: { location_id: string; reason: string }[];
  total_distance_m: number;
  total_duration_s: number;
  distance_source: string;
  explanation: string;
  reasons: string[];
}

export interface AssistantStepResponse {
  type: 'message' | 'tool_calls';
  content?: string;
  calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  provider: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface InsightsResponse {
  insights: {
    type: string;
    title: string;
    body: string;
    sample_size: number;
    confidence: string;
    supporting_data: Record<string, unknown>;
    limitations: string[];
  }[];
  skipped: { type: string; reason: string }[];
}

export interface AiHealth {
  status: string;
  version: string;
  models: { surplus_forecaster: { version: string; algorithm: string; trained_at: string; training_data_label: string; metrics: Record<string, unknown> } | null };
  llm: { provider: string; configured: boolean };
}

/**
 * Authenticated client for the internal AI service. Every AI endpoint is pure
 * computation, so a failed call is retried once with jitter (except the LLM
 * step, which is slow and billed per call).
 */
export class AiClient {
  constructor(
    private readonly cfg: AppConfig['ai'],
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  health(): Promise<AiHealth> {
    return this.request<AiHealth>('GET', '/ai/health', undefined, { retries: 0, timeoutMs: Math.min(this.cfg.timeoutMs, 3000) });
  }
  predictSurplus(body: unknown): Promise<PredictResponse> {
    return this.request('POST', '/ai/predict-surplus', body);
  }
  matchNgos(body: unknown): Promise<MatchResponse> {
    return this.request('POST', '/ai/match-ngos', body);
  }
  matchDonors(body: unknown): Promise<MatchResponse> {
    return this.request('POST', '/ai/match-donors', body);
  }
  allocateFood(body: unknown): Promise<AllocateResponse> {
    return this.request('POST', '/ai/allocate-food', body, { timeoutMs: Math.max(this.cfg.timeoutMs, 12_000) });
  }
  optimizeRoute(body: unknown): Promise<RouteResponse> {
    return this.request('POST', '/ai/optimize-route', body, { timeoutMs: Math.max(this.cfg.timeoutMs, 12_000) });
  }
  assistantStep(body: unknown, requestId?: string): Promise<AssistantStepResponse> {
    return this.request('POST', '/ai/assistant', body, { retries: 0, timeoutMs: this.cfg.assistantTimeoutMs, requestId });
  }
  insights(body: unknown): Promise<InsightsResponse> {
    return this.request('POST', '/ai/insights', body);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    opts: { retries?: number; timeoutMs?: number; requestId?: string | undefined } = {},
  ): Promise<T> {
    const retries = opts.retries ?? 1;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
      try {
        const res = await this.fetchImpl(`${this.cfg.url}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.cfg.token}`,
            'content-type': 'application/json',
            ...(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? this.cfg.timeoutMs),
        });
        const text = await res.text();
        const json = text ? (JSON.parse(text) as unknown) : {};
        if (res.ok) return json as T;
        const err = (json as { error?: { code?: string; message?: string } }).error;
        if (res.status >= 500) {
          lastError = new AiUnavailableError(`AI service error ${res.status}: ${err?.message ?? ''}`.trim(), err?.code ?? 'AI_UNAVAILABLE');
          // 503 LLM_UNAVAILABLE / MODEL_UNAVAILABLE are configuration states, not transient: don't retry.
          if (err?.code === 'LLM_UNAVAILABLE' || err?.code === 'MODEL_UNAVAILABLE') throw lastError;
          continue;
        }
        throw new AiRequestError(err?.message ?? `AI service rejected the request (${res.status})`, res.status, err?.code ?? 'AI_REQUEST_ERROR');
      } catch (err) {
        if (err instanceof AiRequestError) throw err;
        if (err instanceof AiUnavailableError && (err.code === 'LLM_UNAVAILABLE' || err.code === 'MODEL_UNAVAILABLE')) throw err;
        lastError = err;
      }
    }
    const reason = lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : 'unknown error';
    this.logger.warn({ path, reason }, 'AI service unavailable');
    if (lastError instanceof AiUnavailableError) throw lastError;
    throw new AiUnavailableError(`AI service unreachable (${reason})`);
  }
}
