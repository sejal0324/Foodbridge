import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import { AiUnavailableError, type AiClient, type RouteResponse } from '../integrations/ai-client.js';
import type { MapsClient } from '../integrations/maps.js';
import { type Actor, type AuthContext, scopedNgoId } from '../types/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import type { LatLng } from '../validators/common.js';
import { recordAudit } from './audit.service.js';

const SERVICE_TIME_S = 600;

export interface PlanInput {
  planDate: string;
  startTime: Date;
  vehicleCapacity?: number | undefined;
  representativeId?: string | undefined;
  start?: { location: LatLng; address?: string | undefined } | undefined;
  end?: { location: LatLng; address?: string | undefined } | undefined;
  allocationIds: string[];
}

/**
 * Multi-stop collection planning (VRP with time windows) for an NGO. The
 * backend builds the travel matrix (Google Routes when configured, otherwise
 * labelled straight-line estimates); OR-Tools in the AI service sequences the
 * stops. Infeasible stops are reported with reasons, never silently dropped.
 */
export class PlanningService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiClient,
    private readonly maps: MapsClient,
  ) {}

  async create(auth: AuthContext, input: PlanInput, actor: Actor) {
    if (!auth.ngoId) throw forbidden();
    const ngo = await one<{ lat: number | null; lng: number | null; address_line: string | null; default_vehicle_capacity: number | null }>(
      this.db,
      'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, address_line, default_vehicle_capacity FROM ngos WHERE id = $1',
      [auth.ngoId],
    );
    const base = ngo?.lat !== null && ngo?.lat !== undefined && ngo.lng !== null ? { lat: ngo.lat, lng: ngo.lng } : null;
    const start = input.start?.location ?? base;
    const end = input.end?.location ?? base;
    if (!start || !end) throw unprocessable('Set a start and end location (or your NGO location) to plan a route.', 'LOCATION_REQUIRED');
    const capacity = input.vehicleCapacity ?? ngo?.default_vehicle_capacity ?? null;
    if (!capacity) throw unprocessable('Vehicle capacity is required.', 'CAPACITY_REQUIRED');
    const stops = await many<{ id: string; quantity: number; status: string; lat: number; lng: number; address: string; window_start: Date; window_end: Date; food_name: string; donor_name: string }>(
      this.db,
      `SELECT a.id, a.quantity, a.status, ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng, d.address,
              d.pickup_available_from AS window_start, d.pickup_deadline AS window_end, d.food_name, dn.business_name AS donor_name
         FROM donation_allocations a JOIN donations d ON d.id = a.donation_id JOIN donors dn ON dn.id = d.donor_id
        WHERE a.id = ANY($1::uuid[]) AND a.ngo_id = $2`,
      [input.allocationIds, auth.ngoId],
    );
    if (stops.length !== new Set(input.allocationIds).size) throw notFound('One or more allocations');
    const notReady = stops.filter((s) => !['RESERVED', 'PICKUP_ASSIGNED'].includes(s.status));
    if (notReady.length) throw conflict('Only reserved allocations awaiting pickup can be planned.', 'ALLOCATION_NOT_PLANNABLE', { allocationIds: notReady.map((s) => s.id) });

    const points: LatLng[] = [start, ...stops.map((s) => ({ lat: s.lat, lng: s.lng })), end];
    const matrix = await this.maps.matrix(points);
    const t0 = input.startTime.getTime();
    const rel = (d: Date) => Math.round((d.getTime() - t0) / 1000);
    const locations = [
      { id: 'start', type: 'START', demand: 0, window_start_s: null, window_end_s: null, service_time_s: 0 },
      ...stops.map((s) => ({
        id: s.id,
        type: 'PICKUP',
        demand: s.quantity,
        window_start_s: Math.max(0, rel(s.window_start)),
        window_end_s: Math.max(0, rel(s.window_end)),
        service_time_s: SERVICE_TIME_S,
      })),
      { id: 'end', type: 'END', demand: 0, window_start_s: null, window_end_s: null, service_time_s: 0 },
    ];
    let result: RouteResponse | null = null;
    let unavailable = false;
    try {
      result = await this.ai.optimizeRoute({
        locations,
        start_index: 0,
        end_index: locations.length - 1,
        vehicle_capacity: capacity,
        duration_matrix_s: matrix.durations,
        distance_matrix_m: matrix.distances,
        distance_source: matrix.source,
        time_limit_s: 5,
      });
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      unavailable = true;
    }
    const planId = await this.db.transaction(async (tx) => {
      const plan = await one<{ id: string }>(
        tx,
        `INSERT INTO collection_plans (ngo_id, plan_date, representative_id, vehicle_capacity, start_location, start_address, end_location, end_address, start_time,
                                       solver_status, distance_source, total_distance_m, total_duration_s, explanation, infeasibility_reasons, created_by)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography, $10, $11,
                 $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
        [
          auth.ngoId,
          input.planDate,
          input.representativeId ?? null,
          capacity,
          start.lng,
          start.lat,
          input.start?.address ?? ngo?.address_line ?? null,
          end.lng,
          end.lat,
          input.end?.address ?? ngo?.address_line ?? null,
          input.startTime,
          unavailable ? 'UNAVAILABLE' : result?.status,
          matrix.source,
          result?.total_distance_m ?? null,
          result?.total_duration_s ?? null,
          unavailable ? 'Route optimisation is unavailable right now; stops are listed unsequenced.' : `${result?.explanation ?? ''} ${matrix.note}`.trim(),
          unavailable ? ['AI route optimiser unavailable'] : (result?.reasons ?? []),
          auth.userId,
        ],
      );
      const planIdLocal = plan?.id as string;
      const sequenced = new Map((result?.route ?? []).map((r) => [r.location_id, r]));
      const dropped = new Map((result?.dropped ?? []).map((d) => [d.location_id, d.reason]));
      for (const s of stops) {
        const r = sequenced.get(s.id);
        await tx.query(
          `INSERT INTO collection_stops (plan_id, sequence, stop_type, allocation_id, location, address, window_start, window_end, planned_arrival_at, quantity, status, drop_reason)
           VALUES ($1, $2, 'PICKUP', $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, $9, $10, $11, $12)`,
          [planIdLocal, r?.sequence ?? null, s.id, s.lng, s.lat, s.address, s.window_start, s.window_end, r ? new Date(t0 + r.arrival_s * 1000) : null, s.quantity, dropped.has(s.id) ? 'DROPPED' : 'PENDING', dropped.get(s.id) ?? null],
        );
      }
      const endStop = sequenced.get('end');
      await tx.query(
        `INSERT INTO collection_stops (plan_id, sequence, stop_type, location, address, planned_arrival_at, quantity) VALUES ($1, $2, 'DROP_OFF', ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6, 0)`,
        [planIdLocal, endStop?.sequence ?? null, end.lng, end.lat, input.end?.address ?? ngo?.address_line ?? null, endStop ? new Date(t0 + endStop.arrival_s * 1000) : null],
      );
      await recordAudit(tx, actor, { action: 'planning.plan_created', entityType: 'collection_plan', entityId: planIdLocal, metadata: { stops: stops.length, status: unavailable ? 'UNAVAILABLE' : result?.status } });
      return planIdLocal;
    });
    return this.get(auth, planId);
  }

  async list(auth: AuthContext) {
    if (!auth.ngoId) throw forbidden();
    return many(
      this.db,
      `SELECT id, plan_date AS "planDate", status, solver_status AS "solverStatus", distance_source AS "distanceSource", total_distance_m AS "totalDistanceM",
              total_duration_s AS "totalDurationS", created_at AS "createdAt",
              (SELECT count(*)::int FROM collection_stops s WHERE s.plan_id = p.id AND s.stop_type = 'PICKUP') AS "stopCount"
         FROM collection_plans p WHERE ngo_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [auth.ngoId],
    );
  }

  async get(auth: AuthContext, id: string) {
    const plan = await one<Record<string, unknown>>(
      this.db,
      `SELECT id, ngo_id, plan_date, representative_id, vehicle_capacity, ST_Y(start_location::geometry) AS start_lat, ST_X(start_location::geometry) AS start_lng,
              start_address, ST_Y(end_location::geometry) AS end_lat, ST_X(end_location::geometry) AS end_lng, end_address, start_time, status, solver, solver_status,
              distance_source, total_distance_m, total_duration_s, explanation, infeasibility_reasons, created_at
         FROM collection_plans WHERE id = $1`,
      [id],
    );
    if (!plan || (auth.role !== 'ADMIN' && plan.ngo_id !== scopedNgoId(auth))) throw notFound('Collection plan');
    const stops = await many<Record<string, unknown>>(
      this.db,
      `SELECT s.id, s.sequence, s.stop_type, s.allocation_id, ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng, s.address, s.window_start, s.window_end,
              s.planned_arrival_at, s.quantity, s.status, s.drop_reason, d.food_name, dn.business_name AS donor_name
         FROM collection_stops s LEFT JOIN donation_allocations a ON a.id = s.allocation_id LEFT JOIN donations d ON d.id = a.donation_id LEFT JOIN donors dn ON dn.id = d.donor_id
        WHERE s.plan_id = $1 ORDER BY s.sequence NULLS LAST, s.stop_type DESC`,
      [id],
    );
    return {
      id: plan.id,
      planDate: plan.plan_date,
      representativeId: plan.representative_id,
      vehicleCapacity: plan.vehicle_capacity,
      start: { location: { lat: plan.start_lat, lng: plan.start_lng }, address: plan.start_address },
      end: { location: { lat: plan.end_lat, lng: plan.end_lng }, address: plan.end_address },
      startTime: plan.start_time,
      status: plan.status,
      solver: plan.solver,
      solverStatus: plan.solver_status,
      distanceSource: plan.distance_source,
      totalDistanceM: plan.total_distance_m,
      totalDurationS: plan.total_duration_s,
      explanation: plan.explanation,
      infeasibilityReasons: plan.infeasibility_reasons,
      createdAt: plan.created_at,
      stops: stops.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        type: s.stop_type,
        allocationId: s.allocation_id,
        location: { lat: s.lat, lng: s.lng },
        address: s.address,
        windowStart: s.window_start,
        windowEnd: s.window_end,
        plannedArrivalAt: s.planned_arrival_at,
        quantity: s.quantity,
        status: s.status,
        dropReason: s.drop_reason,
        foodName: s.food_name,
        donorName: s.donor_name,
      })),
    };
  }

  async setStatus(auth: AuthContext, id: string, status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED', actor: Actor) {
    await this.db.transaction(async (tx) => {
      const p = await one<{ ngo_id: string; status: string }>(tx, 'SELECT ngo_id, status FROM collection_plans WHERE id = $1 FOR UPDATE', [id]);
      if (!p || p.ngo_id !== auth.ngoId) throw notFound('Collection plan');
      const allowed: Record<string, string[]> = { DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['COMPLETED', 'CANCELLED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'] };
      if (!allowed[p.status]?.includes(status)) throw conflict(`A ${p.status.toLowerCase()} plan cannot become ${status.toLowerCase()}.`, 'INVALID_STATE_TRANSITION');
      await tx.query('UPDATE collection_plans SET status = $2 WHERE id = $1', [id, status]);
      await recordAudit(tx, actor, { action: 'planning.plan_status', entityType: 'collection_plan', entityId: id, changes: { from: p.status, to: status } });
    });
    return this.get(auth, id);
  }
}
