import { z, type ZodType } from 'zod';
import type { Logger } from '../config/logger.js';
import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import { AiRequestError, AiUnavailableError, type AiClient } from '../integrations/ai-client.js';
import type { Actor, AuthContext, Role } from '../types/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { formatDateTime } from '../utils/format.js';
import { assistanceCreateSchema } from '../validators/donation.validators.js';
import type { AnalyticsService } from './analytics.service.js';
import type { AssistanceService } from './assistance.service.js';
import type { BillingService } from './billing.service.js';
import type { DonationService } from './donation.service.js';
import type { MatchingService } from './matching.service.js';
import type { PickupService } from './pickup.service.js';
import type { PlanningService } from './planning.service.js';
import type { PredictionService } from './prediction.service.js';
import type { RewardService } from './reward.service.js';
import type { SettingsService } from './settings.service.js';
import type { VerificationService } from './verification.service.js';

interface ToolDef {
  name: string;
  description: string;
  roles: Role[];
  args: ZodType;
  /** JSON schema sent to the LLM (kept small and explicit). */
  parameters: Record<string, unknown>;
  /** State-changing tools never run directly: they produce a pending action the user must confirm. */
  mutating?: boolean;
  run: (auth: AuthContext, args: never) => Promise<unknown>;
  card: (result: unknown) => { title: string; link?: string };
  keywords?: RegExp;
}

export interface AssistantCard {
  tool: string;
  title: string;
  data: unknown;
  link?: string | undefined;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const MAX_TOOL_RESULT_CHARS = 6000;
const PENDING_ACTION_TTL_MINUTES = 30;
const HISTORY_LIMIT = 24;

/**
 * FoodBridge assistant. The LLM (via the AI service) only proposes tool calls;
 * this service validates every call against the user's role, executes it with
 * the user's own identity through the normal service layer, and requires
 * explicit confirmation for anything that changes data.
 */
export class AssistantService {
  private readonly tools: ToolDef[];

  constructor(
    private readonly db: Database,
    private readonly ai: AiClient,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
    deps: {
      donations: DonationService;
      assistance: AssistanceService;
      matching: MatchingService;
      predictions: PredictionService;
      analytics: AnalyticsService;
      rewards: RewardService;
      billing: BillingService;
      pickups: PickupService;
      planning: PlanningService;
      verification: VerificationService;
    },
  ) {
    const d = deps;
    this.tools = [
      {
        name: 'search_donations',
        description: 'Donors: list their own donations (optionally by status). NGOs: search open donations in the marketplace by diet, distance, category or expiry.',
        roles: ['DONOR', 'NGO'],
        args: z.object({
          status: z.enum(['AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'COMPLETED', 'EXPIRED', 'CANCELLED']).optional(),
          dietaryType: z.enum(['VEG', 'NON_VEG']).optional(),
          maxDistanceKm: z.number().positive().max(100).optional(),
          expiringWithinHours: z.number().positive().max(72).optional(),
        }).strict(),
        parameters: obj({
          status: { type: 'string', enum: ['AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'COMPLETED', 'EXPIRED', 'CANCELLED'] },
          dietaryType: { type: 'string', enum: ['VEG', 'NON_VEG'] },
          maxDistanceKm: { type: 'number' },
          expiringWithinHours: { type: 'number' },
        }),
        run: async (auth, args: { status?: string; dietaryType?: string; maxDistanceKm?: number; expiringWithinHours?: number }) => {
          const r = await d.donations.list(auth, { status: args.status, dietaryType: args.dietaryType, maxDistanceKm: args.maxDistanceKm, sort: args.expiringWithinHours ? 'deadline' : auth.role === 'NGO' ? 'distance' : 'newest', page: 1, pageSize: 20 });
          const cutoff = args.expiringWithinHours ? Date.now() + args.expiringWithinHours * 3_600_000 : null;
          return r.items.filter((i) => !cutoff || new Date(i.pickupDeadline).getTime() <= cutoff);
        },
        card: () => ({ title: 'Donations', link: '/donations' }),
        keywords: /donation|food (available|near)|marketplace|vegetarian|expir/i,
      },
      {
        name: 'get_ngo_recommendations',
        description: "Donor: ranked, explained NGO recommendations for one of the donor's donations (latest open donation if no id is given).",
        roles: ['DONOR'],
        args: z.object({ donationId: z.uuid().optional() }).strict(),
        parameters: obj({ donationId: { type: 'string', description: 'Donation id (optional)' } }),
        run: async (auth, args: { donationId?: string }) => {
          let id = args.donationId;
          if (!id) {
            const latest = await one<{ id: string }>(this.db, `SELECT id FROM donations WHERE donor_id = $1 AND status IN ('AVAILABLE','PARTIALLY_RESERVED') ORDER BY created_at DESC LIMIT 1`, [auth.donorId]);
            if (!latest) return { message: 'You have no open donations to match.' };
            id = latest.id;
          }
          const r = await d.matching.recommendationsForDonation(auth, id);
          return { donationId: id, rankingStatus: r.rankingStatus, recommendations: r.items.filter((i) => i.eligible).slice(0, 5) };
        },
        card: () => ({ title: 'Recommended NGOs' }),
        keywords: /which ngo|recommend.*ngo|ngos? (can|could) collect/i,
      },
      {
        name: 'get_donor_recommendations',
        description: "NGO: ranked, explained donor recommendations for one of the NGO's assistance requests (latest open request if no id is given).",
        roles: ['NGO'],
        args: z.object({ requestId: z.uuid().optional() }).strict(),
        parameters: obj({ requestId: { type: 'string' } }),
        run: async (auth, args: { requestId?: string }) => {
          let id = args.requestId;
          if (!id) {
            const latest = await one<{ id: string }>(this.db, `SELECT id FROM food_assistance_requests WHERE ngo_id = $1 AND status IN ('OPEN','PARTIALLY_FULFILLED') ORDER BY created_at DESC LIMIT 1`, [auth.ngoId]);
            if (!latest) return { message: 'You have no open assistance requests.' };
            id = latest.id;
          }
          const r = await d.matching.recommendationsForRequest(auth, id);
          return { requestId: id, rankingStatus: r.rankingStatus, recommendations: r.items.filter((i) => i.eligible).slice(0, 5) };
        },
        card: () => ({ title: 'Recommended donors' }),
        keywords: /which donor|recommend.*donor/i,
      },
      {
        name: 'get_surplus_forecast',
        description: 'Donor: AI surplus forecast (an estimate, not a donation) for a date (YYYY-MM-DD) or the next two days.',
        roles: ['DONOR'],
        args: z.object({ date: z.iso.date().optional() }).strict(),
        parameters: obj({ date: { type: 'string', description: 'YYYY-MM-DD' } }),
        run: (auth, args: { date?: string }) => d.predictions.forecastForDonor(auth, args.date),
        card: () => ({ title: 'Surplus forecast', link: '/donor/forecast' }),
        keywords: /forecast|predict|surplus/i,
      },
      {
        name: 'get_donor_analytics',
        description: 'Donor: donation totals, meals redistributed, completion rate and monthly history.',
        roles: ['DONOR'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: (auth) => d.analytics.donor(auth),
        card: () => ({ title: 'Your impact', link: '/donor/analytics' }),
        keywords: /this month|analytics|how many (donation|meal)|impact|statistic/i,
      },
      {
        name: 'get_reward_balance',
        description: 'Donor: FoodBridge reward points balance, tier and progress.',
        roles: ['DONOR'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: (auth) => d.rewards.balance(auth),
        card: () => ({ title: 'Rewards', link: '/donor/rewards' }),
        keywords: /reward|points|badge|tier/i,
      },
      {
        name: 'get_pending_requests',
        description: 'Pending items needing action: donor → incoming NGO requests; NGO → own requests awaiting donors and offers awaiting a decision.',
        roles: ['DONOR', 'NGO'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: async (auth) => {
          const requests = await d.donations.listRequests(auth, { status: 'PENDING', page: 1, pageSize: 20 });
          if (auth.role === 'NGO' && auth.ngoId) {
            const offers = await many(
              this.db,
              `SELECT o.id, o.offered_quantity AS "offeredQuantity", o.food_name AS "foodName", dn.business_name AS "donorName", f.id AS "requestId"
                 FROM assistance_offers o JOIN food_assistance_requests f ON f.id = o.assistance_request_id JOIN donors dn ON dn.id = o.donor_id
                WHERE f.ngo_id = $1 AND o.status = 'PROPOSED' ORDER BY o.created_at DESC LIMIT 20`,
              [auth.ngoId],
            );
            return { myPendingDonationRequests: requests.items, offersAwaitingDecision: offers };
          }
          return { incomingRequests: requests.items };
        },
        card: () => ({ title: 'Pending requests', link: '/requests' }),
        keywords: /pending|awaiting|request/i,
      },
      {
        name: 'get_tracking_status',
        description: 'Status of a pickup and its live tracking (or all active pickups if no id is given).',
        roles: ['DONOR', 'NGO', 'ADMIN'],
        args: z.object({ pickupId: z.uuid().optional() }).strict(),
        parameters: obj({ pickupId: { type: 'string' } }),
        run: async (auth, args: { pickupId?: string }) => (args.pickupId ? d.pickups.get(auth, args.pickupId) : d.pickups.list(auth, { active: true })),
        card: () => ({ title: 'Pickups', link: '/pickups' }),
        keywords: /track|where is|pickup status|on the way/i,
      },
      {
        name: 'create_assistance_request',
        description: 'NGO: draft a new food assistance request. It is NOT created until the user confirms it in the app.',
        roles: ['NGO'],
        mutating: true,
        args: z.object({
          categoryCode: z.string().regex(/^[A-Z_]+$/),
          dietaryRequirement: z.enum(['VEG_ONLY', 'ANY']),
          quantityRequired: z.number().int().positive().max(100000),
          unit: z.enum(['MEALS', 'PACKETS', 'BOXES']),
          neededFrom: z.iso.datetime({ offset: true }),
          neededUntil: z.iso.datetime({ offset: true }),
          urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
          beneficiariesCount: z.number().int().positive(),
          reason: z.string().max(1000).optional(),
        }).strict(),
        parameters: obj(
          {
            categoryCode: { type: 'string', enum: ['COOKED_MEALS', 'BAKERY', 'FRUITS_VEGETABLES', 'DAIRY', 'PACKAGED_FOOD', 'BEVERAGES', 'RAW_INGREDIENTS'] },
            dietaryRequirement: { type: 'string', enum: ['VEG_ONLY', 'ANY'] },
            quantityRequired: { type: 'integer' },
            unit: { type: 'string', enum: ['MEALS', 'PACKETS', 'BOXES'] },
            neededFrom: { type: 'string', description: 'ISO 8601 with timezone offset, e.g. 2026-11-04T12:00:00+05:30' },
            neededUntil: { type: 'string', description: 'ISO 8601 with timezone offset' },
            urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
            beneficiariesCount: { type: 'integer' },
            reason: { type: 'string' },
          },
          ['categoryCode', 'dietaryRequirement', 'quantityRequired', 'unit', 'neededFrom', 'neededUntil', 'urgency', 'beneficiariesCount'],
        ),
        run: async () => ({}),
        card: () => ({ title: 'Assistance request (needs your confirmation)' }),
      },
      {
        name: 'get_ngo_analytics',
        description: 'NGO: meals received, collection success rate, requests and fees.',
        roles: ['NGO'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: (auth) => d.analytics.ngo(auth),
        card: () => ({ title: 'NGO analytics', link: '/ngo/analytics' }),
        keywords: /analytics|how many|received|statistic/i,
      },
      {
        name: 'get_service_fee_summary',
        description: 'NGO: service fee summary (₹ per verified unit), outstanding and paid amounts.',
        roles: ['NGO'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: (auth) => d.billing.summary(auth),
        card: () => ({ title: 'Service fees', link: '/ngo/billing' }),
        keywords: /fee|bill|invoice|pay/i,
      },
      {
        name: 'get_collection_plan',
        description: "NGO: the NGO's collection route plans (or one plan by id).",
        roles: ['NGO'],
        args: z.object({ planId: z.uuid().optional() }).strict(),
        parameters: obj({ planId: { type: 'string' } }),
        run: (auth, args: { planId?: string }) => (args.planId ? d.planning.get(auth, args.planId) : d.planning.list(auth)),
        card: () => ({ title: 'Collection plans', link: '/ngo/planning' }),
        keywords: /route|plan|collection plan/i,
      },
      {
        name: 'get_pending_verifications',
        description: 'Admin: donor and NGO applications awaiting verification.',
        roles: ['ADMIN'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: () => d.verification.listApplications({ status: 'PENDING' }),
        card: () => ({ title: 'Pending verifications', link: '/admin/verifications' }),
        keywords: /verification|pending (application|approval)|approve/i,
      },
      {
        name: 'get_admin_analytics',
        description: 'Admin: platform totals, completed donations this period, revenue and matching performance.',
        roles: ['ADMIN'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: () => d.analytics.admin(),
        card: () => ({ title: 'Platform analytics', link: '/admin/analytics' }),
        keywords: /how many|completed|this week|analytics|platform/i,
      },
      {
        name: 'get_delayed_collections',
        description: 'Admin: pickups that are late (past their scheduled time or deadline without handover).',
        roles: ['ADMIN'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: () =>
          many(
            this.db,
            `SELECT p.id AS "pickupId", p.status, p.scheduled_pickup_at AS "scheduledPickupAt", d.pickup_deadline AS "pickupDeadline", d.food_name AS "foodName",
                    dn.business_name AS "donorName", n.organization_name AS "ngoName"
               FROM pickup_assignments p JOIN donation_allocations a ON a.id = p.allocation_id JOIN donations d ON d.id = a.donation_id
               JOIN donors dn ON dn.id = d.donor_id JOIN ngos n ON n.id = p.ngo_id
              WHERE p.status IN ('ASSIGNED','EN_ROUTE','VERIFIED') AND (p.scheduled_pickup_at < now() - interval '30 minutes' OR d.pickup_deadline < now())
              ORDER BY d.pickup_deadline LIMIT 50`,
          ),
        card: () => ({ title: 'Delayed collections', link: '/admin/pickups' }),
        keywords: /delay|late|overdue/i,
      },
      {
        name: 'get_matching_performance',
        description: 'Admin: matching runs, fallback rate, notification response rate and average scores.',
        roles: ['ADMIN'],
        args: z.object({}).strict(),
        parameters: obj({}),
        run: () => d.analytics.matchingPerformance(),
        card: () => ({ title: 'Matching performance', link: '/admin/ai' }),
        keywords: /matching/i,
      },
    ];
  }

  private toolsFor(role: Role) {
    return this.tools.filter((t) => t.roles.includes(role));
  }

  /** Suggested questions shown in the UI, each mapped to a direct-intent fallback. */
  suggestions(role: Role) {
    const byRole: Record<Role, { text: string; intent: string }[]> = {
      DONOR: [
        { text: 'Which NGOs can collect my remaining meals?', intent: 'get_ngo_recommendations' },
        { text: 'Show my donations this month', intent: 'get_donor_analytics' },
        { text: 'How many reward points have I earned?', intent: 'get_reward_balance' },
        { text: 'What is my predicted surplus tomorrow?', intent: 'get_surplus_forecast' },
        { text: 'Show pending requests for my food', intent: 'get_pending_requests' },
      ],
      NGO: [
        { text: 'Find vegetarian donations within 5 km', intent: 'search_donations' },
        { text: 'Show donations expiring soon', intent: 'search_donations' },
        { text: 'What is my service fee?', intent: 'get_service_fee_summary' },
        { text: 'Show pending pickup requests', intent: 'get_pending_requests' },
        { text: 'I need 100 meals tomorrow', intent: 'create_assistance_request' },
      ],
      ADMIN: [
        { text: 'Show pending verification applications', intent: 'get_pending_verifications' },
        { text: 'How many donations were completed this week?', intent: 'get_admin_analytics' },
        { text: 'Which collections experienced delays?', intent: 'get_delayed_collections' },
        { text: 'Show matching performance', intent: 'get_matching_performance' },
      ],
    };
    return byRole[role];
  }

  private async conversation(auth: AuthContext, conversationId: string | undefined, firstMessage: string): Promise<string> {
    if (conversationId) {
      const c = await one<{ id: string }>(this.db, 'SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [conversationId, auth.userId]);
      if (!c) throw notFound('Conversation');
      return c.id;
    }
    const c = await one<{ id: string }>(this.db, 'INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id', [auth.userId, firstMessage.slice(0, 80)]);
    return c?.id as string;
  }

  private async log(conversationId: string, auth: AuthContext, row: Record<string, unknown>): Promise<number> {
    const r = await one<{ id: number }>(
      this.db,
      `INSERT INTO ai_interactions (conversation_id, user_id, role, content, tool_call_id, tool_name, tool_arguments, tool_result_summary, pending_action, action_status,
                                    provider, model, prompt_tokens, completion_tokens, latency_ms, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [
        conversationId,
        auth.userId,
        row.role,
        row.content ?? null,
        row.toolCallId ?? null,
        row.toolName ?? null,
        row.toolArguments === undefined ? null : JSON.stringify(row.toolArguments),
        row.toolResult === undefined ? null : JSON.stringify(row.toolResult),
        row.pendingAction === undefined ? null : JSON.stringify(row.pendingAction),
        row.actionStatus ?? null,
        row.provider ?? null,
        row.model ?? null,
        row.promptTokens ?? null,
        row.completionTokens ?? null,
        row.latencyMs ?? null,
        row.status ?? 'OK',
      ],
    );
    await this.db.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conversationId]);
    return r?.id as number;
  }

  private async history(conversationId: string) {
    const rows = await many<{ role: string; content: string | null; tool_call_id: string | null; tool_name: string | null; tool_arguments: unknown; tool_result_summary: unknown }>(
      this.db,
      `SELECT role, content, tool_call_id, tool_name, tool_arguments, tool_result_summary FROM (
         SELECT * FROM ai_interactions WHERE conversation_id = $1 AND status = 'OK' ORDER BY id DESC LIMIT $2) x ORDER BY id`,
      [conversationId, HISTORY_LIMIT],
    );
    const messages: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (r.role === 'USER') messages.push({ role: 'user', content: r.content });
      else if (r.role === 'ASSISTANT' && Array.isArray(r.tool_arguments)) messages.push({ role: 'assistant', content: null, tool_calls: r.tool_arguments });
      else if (r.role === 'ASSISTANT') messages.push({ role: 'assistant', content: r.content });
      else if (r.role === 'TOOL') messages.push({ role: 'tool', tool_call_id: r.tool_call_id, name: r.tool_name, content: JSON.stringify(r.tool_result_summary ?? {}).slice(0, MAX_TOOL_RESULT_CHARS) });
    }
    // A tool message must follow the assistant message that requested it; drop orphans at the window edge.
    while (messages[0] && messages[0].role === 'tool') messages.shift();
    return messages;
  }

  private systemPrompt(auth: AuthContext): string {
    return [
      'You are the FoodBridge AI assistant, helping food donors, NGOs and administrators coordinate surplus-food redistribution in India.',
      `The signed-in user is ${auth.fullName} with role ${auth.role}. Identity and permissions are enforced by the backend; you cannot change them.`,
      `Current time: ${formatDateTime(new Date())} (Asia/Kolkata). Use ISO 8601 with +05:30 offsets for times.`,
      'Answer ONLY from tool results. If a tool returns no data or an error, say so plainly. Never invent numbers, names, distances, ETAs or statuses.',
      'Distances are straight-line estimates unless a result says they come from road routing. Forecasts are estimates, never donations.',
      'You cannot approve handovers, payments or rewards, and you cannot change data directly. To create an assistance request, call create_assistance_request; the user must then confirm it in the app.',
      'FoodBridge does not certify food safety; humans decide whether food is safe.',
      'Keep answers short and practical. Use plain language.',
    ].join('\n');
  }

  private async execute(auth: AuthContext, tool: ToolDef, rawArgs: unknown) {
    const parsed = tool.args.safeParse(rawArgs ?? {});
    if (!parsed.success) return { ok: false as const, error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    try {
      return { ok: true as const, result: await tool.run(auth, parsed.data as never) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'tool failed';
      return { ok: false as const, error: message };
    }
  }

  private async pendingAction(conversationId: string, auth: AuthContext, tool: ToolDef, args: unknown) {
    const parsed = tool.args.safeParse(args ?? {});
    if (!parsed.success) return { error: `Invalid request details: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
    const a = parsed.data as { categoryCode: string; quantityRequired: number; unit: string; neededFrom: string; neededUntil: string; dietaryRequirement: string };
    const id = await this.log(conversationId, auth, { role: 'ASSISTANT', content: 'Pending confirmation', toolName: tool.name, toolArguments: a, pendingAction: { tool: tool.name, payload: a }, actionStatus: 'PENDING' });
    return {
      id,
      tool: tool.name,
      summary: `Create an assistance request for ${a.quantityRequired} ${a.unit.toLowerCase()} (${a.categoryCode.replace(/_/g, ' ').toLowerCase()}, ${a.dietaryRequirement === 'VEG_ONLY' ? 'vegetarian only' : 'any diet'}) needed ${formatDateTime(new Date(a.neededFrom))}–${formatDateTime(new Date(a.neededUntil))}.`,
      payload: a,
      expiresInMinutes: PENDING_ACTION_TTL_MINUTES,
    };
  }

  /** One user turn. Falls back to direct tool results when the LLM is unavailable. */
  async chat(auth: AuthContext, input: { message: string; conversationId?: string | undefined; intent?: string | undefined }, requestId?: string) {
    const conversationId = await this.conversation(auth, input.conversationId, input.message);
    await this.log(conversationId, auth, { role: 'USER', content: input.message });
    const allowed = this.toolsFor(auth.role);
    const cards: AssistantCard[] = [];

    // Explicit intent from a suggested-question chip: run the tool directly (no LLM needed).
    const direct = input.intent ? allowed.find((t) => t.name === input.intent && !t.mutating) : undefined;
    if (input.intent && !direct && !allowed.some((t) => t.name === input.intent)) throw forbidden('That assistant action is not available for your role.');
    if (direct) return this.directAnswer(conversationId, auth, direct, cards, 'DIRECT');

    const maxSteps = await this.settings.get('assistant.max_steps');
    const tools = allowed.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
    let pendingAction: unknown = null;
    for (let step = 0; step < maxSteps; step++) {
      const messages = [{ role: 'system', content: this.systemPrompt(auth) }, ...(await this.history(conversationId))];
      const started = Date.now();
      let res;
      try {
        res = await this.ai.assistantStep({ messages, tools, temperature: 0.2 }, requestId);
      } catch (err) {
        if (err instanceof AiUnavailableError || err instanceof AiRequestError) {
          this.logger.warn({ err: err.message }, 'assistant LLM unavailable; using direct fallback');
          const guess = allowed.find((t) => !t.mutating && t.keywords?.test(input.message));
          if (guess) return this.directAnswer(conversationId, auth, guess, cards, 'FALLBACK');
          const text = 'The AI assistant is unavailable right now. You can still use the suggested questions below, or the dashboard pages directly.';
          await this.log(conversationId, auth, { role: 'ASSISTANT', content: text, status: 'UNAVAILABLE' });
          return { conversationId, mode: 'UNAVAILABLE', message: text, cards, pendingAction: null, suggestions: this.suggestions(auth.role) };
        }
        throw err;
      }
      const latencyMs = Date.now() - started;
      if (res.type === 'message' || !res.calls?.length) {
        const text = res.content?.trim() || 'I could not produce an answer from the available data.';
        await this.log(conversationId, auth, { role: 'ASSISTANT', content: text, provider: res.provider, model: res.model, promptTokens: res.usage?.prompt_tokens, completionTokens: res.usage?.completion_tokens, latencyMs });
        return { conversationId, mode: 'LLM', message: text, cards, pendingAction, provider: res.provider, model: res.model };
      }
      await this.log(conversationId, auth, { role: 'ASSISTANT', toolArguments: res.calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })), provider: res.provider, model: res.model, latencyMs });
      for (const call of res.calls) {
        const tool = allowed.find((t) => t.name === call.name);
        let summary: unknown;
        if (!tool) summary = { error: `Tool ${call.name} is not available for this user.` };
        else if (tool.mutating) {
          pendingAction = await this.pendingAction(conversationId, auth, tool, call.arguments);
          summary = { status: 'PENDING_USER_CONFIRMATION', note: 'Nothing has been created yet. Tell the user to review and confirm it in the app.' };
          cards.push(roleCard(auth.role, { tool: tool.name, ...tool.card(null), data: pendingAction }));
        } else {
          const out = await this.execute(auth, tool, call.arguments);
          summary = out.ok ? out.result : { error: out.error };
          if (out.ok) cards.push(roleCard(auth.role, { tool: tool.name, ...tool.card(out.result), data: out.result }));
        }
        await this.log(conversationId, auth, { role: 'TOOL', toolCallId: call.id, toolName: call.name, toolArguments: call.arguments, toolResult: truncate(summary) });
      }
    }
    const text = 'I gathered the results above but could not finish summarising them. Please review the cards.';
    await this.log(conversationId, auth, { role: 'ASSISTANT', content: text });
    return { conversationId, mode: 'LLM', message: text, cards, pendingAction };
  }

  private async directAnswer(conversationId: string, auth: AuthContext, tool: ToolDef, cards: AssistantCard[], mode: 'DIRECT' | 'FALLBACK') {
    const out = await this.execute(auth, tool, {});
    if (out.ok) cards.push(roleCard(auth.role, { tool: tool.name, ...tool.card(out.result), data: out.result }));
    const text = out.ok
      ? mode === 'FALLBACK'
        ? `The AI assistant is unavailable right now, so here are the direct results for “${tool.card(out.result).title}”.`
        : `Here are the results for “${tool.card(out.result).title}”.`
      : `I could not load that information: ${out.error}`;
    await this.log(conversationId, auth, { role: 'ASSISTANT', content: text, toolName: tool.name, status: out.ok ? 'OK' : 'ERROR' });
    return { conversationId, mode, message: text, cards, pendingAction: null };
  }

  /** Executes a pending state-changing action after the user explicitly confirms it. */
  async confirmAction(auth: AuthContext, interactionId: number, actor: Actor, deps: { assistance: AssistanceService }) {
    const row = await one<{ pending_action: { tool: string; payload: Record<string, unknown> }; action_status: string; created_at: Date }>(
      this.db,
      'SELECT pending_action, action_status, created_at FROM ai_interactions WHERE id = $1 AND user_id = $2',
      [interactionId, auth.userId],
    );
    if (!row?.pending_action) throw notFound('Pending action');
    if (row.action_status !== 'PENDING') throw conflict(`This action is already ${row.action_status.toLowerCase()}.`, 'ACTION_NOT_PENDING');
    if (Date.now() - row.created_at.getTime() > PENDING_ACTION_TTL_MINUTES * 60_000) {
      await this.db.query(`UPDATE ai_interactions SET action_status = 'EXPIRED' WHERE id = $1`, [interactionId]);
      throw conflict('This pending action has expired. Ask the assistant again.', 'ACTION_EXPIRED');
    }
    if (row.pending_action.tool !== 'create_assistance_request' || auth.role !== 'NGO') throw forbidden();
    const p = row.pending_action.payload as { categoryCode: string } & Record<string, unknown>;
    const category = await one<{ id: string }>(this.db, 'SELECT id FROM food_categories WHERE code = $1 AND is_active', [p.categoryCode]);
    if (!category) throw unprocessable('Unknown food category.', 'UNKNOWN_CATEGORY');
    const { categoryCode: _c, ...rest } = p;
    const input = assistanceCreateSchema.parse({ ...rest, categoryId: category.id });
    if (auth.ngoStatus !== 'APPROVED') throw forbidden('Your organisation must be verified by FoodBridge before you can do this.', 'ORGANISATION_NOT_APPROVED');
    // Claim the action atomically so concurrent confirmations cannot both execute it.
    const claimed = await this.db.query(`UPDATE ai_interactions SET action_status = 'CONFIRMED' WHERE id = $1 AND user_id = $2 AND action_status = 'PENDING'`, [interactionId, auth.userId]);
    if (claimed.rowCount === 0) throw conflict('This action has already been handled.', 'ACTION_NOT_PENDING');
    try {
      return await deps.assistance.create(auth, input, actor);
    } catch (err) {
      await this.db.query(`UPDATE ai_interactions SET action_status = 'FAILED' WHERE id = $1`, [interactionId]);
      throw err;
    }
  }

  async cancelAction(auth: AuthContext, interactionId: number) {
    const res = await this.db.query(`UPDATE ai_interactions SET action_status = 'CANCELLED' WHERE id = $1 AND user_id = $2 AND action_status = 'PENDING'`, [interactionId, auth.userId]);
    if (res.rowCount === 0) throw notFound('Pending action');
  }

  async conversations(auth: AuthContext) {
    return many(this.db, 'SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt" FROM ai_conversations WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 30', [auth.userId]);
  }

  async messages(auth: AuthContext, conversationId: string) {
    const c = await one<{ id: string }>(this.db, 'SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [conversationId, auth.userId]);
    if (!c) throw notFound('Conversation');
    return many(
      this.db,
      `SELECT id, role, content, tool_name AS "toolName", pending_action AS "pendingAction", action_status AS "actionStatus", status, created_at AS "createdAt"
         FROM ai_interactions WHERE conversation_id = $1 AND (role = 'USER' OR (role = 'ASSISTANT' AND content IS NOT NULL)) ORDER BY id`,
      [conversationId],
    );
  }

  /** Retention for assistant logs. */
  async purgeOld(days: number) {
    const res = await this.db.query(`DELETE FROM ai_conversations WHERE updated_at < now() - make_interval(days => $1)`, [days]);
    return res.rowCount ?? 0;
  }
}

/** Maps role-neutral card links to the signed-in user's area of the web app. */
const ROLE_LINKS: Record<string, Partial<Record<Role, string>>> = {
  '/donations': { DONOR: '/donor/donations', NGO: '/ngo/marketplace', ADMIN: '/admin/donations' },
  '/requests': { DONOR: '/donor/donations', NGO: '/ngo/requests', ADMIN: '/admin/donations' },
  '/pickups': { DONOR: '/donor/pickups', NGO: '/ngo/pickups', ADMIN: '/admin/pickups' },
};

function roleCard(role: Role, card: AssistantCard): AssistantCard {
  if (!card.link) return card;
  const mapped = ROLE_LINKS[card.link]?.[role];
  return { ...card, link: mapped ?? card.link };
}

function truncate(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return value;
  return { truncated: true, preview: text.slice(0, MAX_TOOL_RESULT_CHARS) };
}
