"""Single-vehicle pickup routing with time windows (VRPTW) using OR-Tools routing.

Model:
* time dimension: transit(i, j) = service_time[i] + duration[i][j]; waiting is
  allowed (slack); each stop's service must start inside its window;
* capacity dimension: load grows by each pickup's demand, <= vehicle_capacity;
* each pickup is optional with a drop penalty that dominates any travel cost
  and grows with the stop's demand, so the solver serves as much quantity as
  possible and returns a partial plan when not everything fits;
* arc cost = travel duration (seconds).

Search: greedy-descent local search started from each of several first-solution
strategies; the best objective wins (deterministic, each run stops at a local
optimum, all within ``time_limit_s``). Routing heuristics do not
prove optimality, so a complete plan is reported as FEASIBLE, unless the stops
are few enough for an exhaustive check (``EXACT_CHECK_MAX_STOPS``) that confirms
it is OPTIMAL.
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from app.schemas.route import (
    DroppedStop,
    Location,
    OptimizeRouteRequest,
    OptimizeRouteResponse,
    RouteStatus,
    RouteStop,
)
from app.utils.text import fmt_distance

EXACT_CHECK_MAX_STOPS = 7
ESTIMATE_REASON = (
    "Travel times and distances are straight-line estimates, not road data; real travel may "
    "take longer."
)
WAITING_REASON = (
    "arrival_s is the planned service start; the vehicle may arrive earlier and wait for a "
    "window to open."
)
_STATUS = routing_enums_pb2.RoutingSearchStatus
_FIRST = routing_enums_pb2.FirstSolutionStrategy
FIRST_SOLUTION_STRATEGIES: tuple[int, ...] = (
    _FIRST.PATH_CHEAPEST_ARC,
    _FIRST.PARALLEL_CHEAPEST_INSERTION,
    _FIRST.LOCAL_CHEAPEST_INSERTION,
    _FIRST.SAVINGS,
    _FIRST.GLOBAL_CHEAPEST_ARC,
    _FIRST.LOCAL_CHEAPEST_ARC,
    _FIRST.FIRST_UNBOUND_MIN_VALUE,
    _FIRST.CHRISTOFIDES,
)


@dataclass(frozen=True)
class _Problem:
    request: OptimizeRouteRequest
    locations: list[Location]
    start: int
    end: int
    pickups: list[int]
    pickup_set: frozenset[int]
    horizon: int

    def window(self, node: int) -> tuple[int, int]:
        loc = self.locations[node]
        low = loc.window_start_s if loc.window_start_s is not None else 0
        high = loc.window_end_s if loc.window_end_s is not None else self.horizon
        return low, high

    def transit(self, i: int, j: int) -> int:
        return self.locations[i].service_time_s + self.request.duration_matrix_s[i][j]


def _problem(request: OptimizeRouteRequest) -> _Problem:
    locations = request.locations
    special = {request.start_index, request.end_index}
    pickups = [i for i in range(len(locations)) if i not in special]
    max_window = max(
        [loc.window_end_s or 0 for loc in locations]
        + [loc.window_start_s or 0 for loc in locations]
    )
    max_row = sum(max(row) for row in request.duration_matrix_s)
    horizon = max_window + sum(loc.service_time_s for loc in locations) + max_row + 1
    return _Problem(
        request=request,
        locations=locations,
        start=request.start_index,
        end=request.end_index,
        pickups=pickups,
        pickup_set=frozenset(pickups),
        horizon=horizon,
    )


@dataclass(frozen=True)
class _Attempt:
    order: list[int] | None  # visited node order incl. start and end
    objective: int | None
    status: int


@dataclass
class _Plan:
    order: list[int]  # node sequence including start and end
    times: list[int]  # service start per position


def _simulate(problem: _Problem, order: list[int], start_time: int | None = None) -> _Plan | None:
    """Earliest-start schedule for a fixed order, or None if a window or capacity fails."""
    load = sum(problem.locations[n].demand for n in order if n in problem.pickup_set)
    if load > problem.request.vehicle_capacity:
        return None
    low, high = problem.window(order[0])
    clock = low if start_time is None else start_time
    if clock < low or clock > high:
        return None
    times = [clock]
    for prev, node in itertools.pairwise(order):
        clock += problem.transit(prev, node)
        low, high = problem.window(node)
        clock = max(clock, low)
        if clock > high:
            return None
        times.append(clock)
    return _Plan(order=order, times=times)


def _schedule(problem: _Problem, order: list[int]) -> _Plan | None:
    """Earliest schedule, with departure delayed as far as possible without arriving later.

    Delaying the start only removes waiting; binary search finds the largest
    delay that keeps the route feasible and its end time unchanged.
    """
    earliest = _simulate(problem, order)
    if earliest is None:
        return None
    _, start_high = problem.window(order[0])
    lo, hi = 0, start_high - earliest.times[0]
    best = earliest
    while lo < hi:
        mid = (lo + hi + 1) // 2
        candidate = _simulate(problem, order, earliest.times[0] + mid)
        if candidate is not None and candidate.times[-1] == earliest.times[-1]:
            lo, best = mid, candidate
        else:
            hi = mid - 1
    return best


def _travel(problem: _Problem, order: list[int]) -> int:
    matrix = problem.request.duration_matrix_s
    return sum(matrix[i][j] for i, j in itertools.pairwise(order))


def _solve_once(problem: _Problem, first_solution: int, time_limit_ms: int) -> _Attempt:
    request = problem.request
    n = len(problem.locations)
    manager = pywrapcp.RoutingIndexManager(n, 1, [problem.start], [problem.end])
    routing = pywrapcp.RoutingModel(manager)
    durations = request.duration_matrix_s

    def travel_cb(from_index: int, to_index: int) -> int:
        return durations[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    def time_cb(from_index: int, to_index: int) -> int:
        return problem.transit(manager.IndexToNode(from_index), manager.IndexToNode(to_index))

    def demand_cb(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        return problem.locations[node].demand if node in problem.pickup_set else 0

    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(travel_cb))
    time_index = routing.RegisterTransitCallback(time_cb)
    routing.AddDimension(time_index, problem.horizon, problem.horizon, False, "Time")
    time_dim = routing.GetDimensionOrDie("Time")
    routing.AddDimensionWithVehicleCapacity(
        routing.RegisterUnaryTransitCallback(demand_cb),
        0,
        [request.vehicle_capacity],
        True,
        "Capacity",
    )
    for node in problem.pickups:
        low, high = problem.window(node)
        time_dim.CumulVar(manager.NodeToIndex(node)).SetRange(low, high)
    start_low, start_high = problem.window(problem.start)
    end_low, end_high = problem.window(problem.end)
    time_dim.CumulVar(routing.Start(0)).SetRange(start_low, start_high)
    time_dim.CumulVar(routing.End(0)).SetRange(end_low, end_high)

    # Dropping a stop costs more than any route's total travel, scaled by demand.
    base_penalty = sum(max(row) for row in durations) + 1
    for node in problem.pickups:
        penalty = base_penalty * (1 + problem.locations[node].demand)
        routing.AddDisjunction([manager.NodeToIndex(node)], penalty)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = first_solution
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GREEDY_DESCENT
    params.time_limit.FromMilliseconds(max(time_limit_ms, 10))
    solution = routing.SolveWithParameters(params)
    status = int(routing.status())
    if solution is None:
        return _Attempt(order=None, objective=None, status=status)
    order: list[int] = []
    index = routing.Start(0)
    while True:
        order.append(manager.IndexToNode(index))
        if routing.IsEnd(index):
            break
        index = solution.Value(routing.NextVar(index))
    return _Attempt(order=order, objective=int(solution.ObjectiveValue()), status=status)


def _solve(problem: _Problem) -> _Attempt:
    """Greedy descent from several first-solution strategies; keep the best objective.

    Deterministic multi-start: strategies run in a fixed order and ties keep the
    earlier one. On test instances this beat time-limited guided local search.
    """
    deadline = time.monotonic() + problem.request.time_limit_s
    best: _Attempt | None = None
    last = _Attempt(order=None, objective=None, status=int(_STATUS.ROUTING_NOT_SOLVED))
    for position, strategy in enumerate(FIRST_SOLUTION_STRATEGIES):
        remaining = deadline - time.monotonic()
        if remaining <= 0 and best is not None:
            break
        share = max(remaining, 0.0) / (len(FIRST_SOLUTION_STRATEGIES) - position)
        last = _solve_once(problem, strategy, int(share * 1000))
        if last.objective is None:
            continue
        if best is None or best.objective is None or last.objective < best.objective:
            best = last
    return best if best is not None else last


def _best_order_exhaustive(problem: _Problem, stops: list[int]) -> int | None:
    """Minimum travel time over all feasible orders of ``stops`` (small inputs only)."""
    best: int | None = None
    for perm in itertools.permutations(stops):
        order = [problem.start, *perm, problem.end]
        if _simulate(problem, order) is None:
            continue
        cost = _travel(problem, order)
        if best is None or cost < best:
            best = cost
    return best


def _drop_reason(problem: _Problem, node: int, served_load: int) -> str:
    loc = problem.locations[node]
    capacity = problem.request.vehicle_capacity
    if loc.demand > capacity:
        return f"demand {loc.demand} exceeds vehicle capacity {capacity}"
    start_low, _ = problem.window(problem.start)
    earliest = start_low + problem.transit(problem.start, node)
    low, high = problem.window(node)
    if earliest > high:
        return f"time window ends before earliest possible arrival ({earliest}s > {high}s)"
    finish = max(earliest, low) + problem.transit(node, problem.end)
    _, end_high = problem.window(problem.end)
    if finish > end_high:
        return (
            "visiting it makes the vehicle miss the end location's window "
            f"({finish}s > {end_high}s)"
        )
    if served_load + loc.demand > capacity:
        return (
            f"total demand {served_load + loc.demand} exceeds vehicle capacity {capacity} "
            f"({served_load} already collected on the route + {loc.demand} at this stop)"
        )
    return (
        "no position in the route reaches it within its time window "
        f"({low}s-{high}s) without making another stop miss its window"
    )


def _infeasible_reason(problem: _Problem) -> str:
    start_low, start_high = problem.window(problem.start)
    _, end_high = problem.window(problem.end)
    direct = start_low + problem.transit(problem.start, problem.end)
    if direct > end_high:
        return (
            "even a direct trip from start to end arrives after the end window closes "
            f"({direct}s > {end_high}s)"
        )
    if start_low > start_high:
        return "the start window is empty"
    return "no route satisfies the time windows and vehicle capacity"


def optimize_route(request: OptimizeRouteRequest) -> OptimizeRouteResponse:
    problem = _problem(request)
    reasons: list[str] = []
    estimate = request.distance_source.value == "STRAIGHT_LINE_ESTIMATE"
    if estimate:
        reasons.append(ESTIMATE_REASON)

    if problem.pickups:
        attempt = _solve(problem)
        order, routing_status = attempt.order, attempt.status
    else:
        order, routing_status = [problem.start, problem.end], int(_STATUS.ROUTING_SUCCESS)

    if order is None:
        timeout = routing_status == _STATUS.ROUTING_FAIL_TIMEOUT
        failed: RouteStatus = "TIMEOUT" if timeout else "INFEASIBLE"
        reason = (
            f"no route was found within the {request.time_limit_s:g} s time limit"
            if timeout
            else _infeasible_reason(problem)
        )
        reasons.append(f"No route: {reason}.")
        return OptimizeRouteResponse(
            status=failed,
            route=[],
            dropped=[
                DroppedStop(location_id=problem.locations[n].id, reason=reason)
                for n in problem.pickups
            ],
            total_distance_m=0,
            total_duration_s=0,
            distance_source=request.distance_source,
            explanation=f"No pickup route could be planned: {reason}."
            + (" " + ESTIMATE_REASON if estimate else ""),
            reasons=reasons,
        )

    plan = _schedule(problem, order)
    if plan is None:  # defensive: the solver's route must satisfy our own check
        raise RuntimeError("solver returned a route that violates constraints")

    served = [n for n in order if n in problem.pickup_set]
    served_load = sum(problem.locations[n].demand for n in served)
    dropped = [
        DroppedStop(
            location_id=problem.locations[n].id, reason=_drop_reason(problem, n, served_load)
        )
        for n in problem.pickups
        if n not in served
    ]

    route: list[RouteStop] = []
    load = 0
    for position, (node, arrival) in enumerate(zip(plan.order, plan.times, strict=True)):
        loc = problem.locations[node]
        if node in problem.pickup_set:
            load += loc.demand
        is_last = position == len(plan.order) - 1
        route.append(
            RouteStop(
                location_id=loc.id,
                sequence=position,
                arrival_s=arrival,
                departure_s=arrival if is_last else arrival + loc.service_time_s,
                load_after=load,
            )
        )
    distance = sum(request.distance_matrix_m[i][j] for i, j in itertools.pairwise(plan.order))
    duration = plan.times[-1] - plan.times[0]

    status: RouteStatus
    if problem.pickups and not served:
        status = "INFEASIBLE"
    elif dropped:
        status = "PARTIAL"
    elif routing_status == _STATUS.ROUTING_OPTIMAL:
        status = "OPTIMAL"
    elif len(served) <= EXACT_CHECK_MAX_STOPS:
        best = _best_order_exhaustive(problem, served)
        status = "OPTIMAL" if best is not None and _travel(problem, order) <= best else "FEASIBLE"
    else:
        status = "FEASIBLE"

    if status == "FEASIBLE":
        reasons.append("The route comes from heuristic search; optimality is not proven.")
    if status == "OPTIMAL" and served:
        reasons.append(
            "All pickups are served and no other visiting order has a lower total travel time."
        )
    for stop in dropped:
        reasons.append(f"Dropped {stop.location_id}: {stop.reason}.")
    if served:
        reasons.append(WAITING_REASON)

    total_demand = sum(problem.locations[n].demand for n in problem.pickups)
    explanation = (
        f"Visit {len(served)} of {len(problem.pickups)} pickup stops in the order shown, "
        f"collecting {served_load} of {total_demand} units over {fmt_distance(distance)} in about "
        f"{round(duration / 60)} min (vehicle capacity {request.vehicle_capacity})."
    )
    if dropped:
        explanation += f" {len(dropped)} stop(s) could not be included; see 'dropped' for reasons."
    if estimate:
        explanation += " " + ESTIMATE_REASON
    explanation += " This is a recommended plan; the NGO confirms it before it is used."
    return OptimizeRouteResponse(
        status=status,
        route=route,
        dropped=dropped,
        total_distance_m=int(distance),
        total_duration_s=int(duration),
        distance_source=request.distance_source,
        explanation=explanation,
        reasons=reasons,
    )
