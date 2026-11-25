"""Integer food allocation with OR-Tools CP-SAT (a recommendation only).

Variables: ``x[e]`` (integer quantity on edge e) and ``y[e]`` (edge used).

Constraints:
    0 <= x[e] <= cap[e] * y[e],  cap[e] = min(edge.max_quantity, supply, demand)
    x[e] >= min_quantity[demand] * y[e]          (x = 0 or x >= min_quantity)
    sum_d x[s, d] <= supply[s];  sum_s x[s, d] <= demand[d]

Lexicographic objective, solved in three stages (each stage keeps the previous
optimum as a constraint and starts from the previous solution as a hint):
    1. maximise total allocated quantity
    2. maximise score-weighted quantity  (sum round(score * 100) * x)
    3. minimise the number of non-zero edges (fewer pickups)

The search runs single-threaded with a fixed seed, so the same input yields the
same plan whenever the solver finishes within the time limit.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.core.errors import AppError
from app.schemas.allocation import (
    AllocateFoodRequest,
    AllocateFoodResponse,
    Allocation,
    AllocationStatus,
    Demand,
    Edge,
    Remaining,
    Supply,
)

MAX_REASONS = 40
MIN_STAGE_SECONDS = 0.05
SEED = 0


@dataclass(frozen=True)
class _UsableEdge:
    edge: Edge
    cap: int


def _prepare_edges(
    request: AllocateFoodRequest,
    supplies: dict[str, Supply],
    demands: dict[str, Demand],
    reasons: list[str],
) -> list[_UsableEdge]:
    usable: list[_UsableEdge] = []
    for edge in request.edges:
        supply, demand = supplies[edge.supply_id], demands[edge.demand_id]
        limits = [supply.quantity, demand.quantity]
        if edge.max_quantity is not None:
            limits.append(edge.max_quantity)
        cap = min(limits)
        if cap < demand.min_quantity:
            reasons.append(
                f"Edge {edge.supply_id} -> {edge.demand_id} can carry at most {cap}, below "
                f"demand {demand.id}'s minimum of {demand.min_quantity}, so it cannot be used."
            )
            continue
        usable.append(_UsableEdge(edge=edge, cap=cap))
    return usable


def _structural_reasons(
    request: AllocateFoodRequest, supplies: dict[str, Supply], demands: dict[str, Demand]
) -> list[str]:
    reasons: list[str] = []
    if not request.edges:
        reasons.append("No edges were provided, so no supply can be matched to any demand.")
        return reasons
    with_edges_s = {e.supply_id for e in request.edges}
    with_edges_d = {e.demand_id for e in request.edges}
    for supply in supplies.values():
        if supply.quantity == 0:
            reasons.append(f"Supply {supply.id} has quantity 0.")
        elif supply.id not in with_edges_s:
            reasons.append(f"Supply {supply.id} has no edges to any demand.")
    for demand in demands.values():
        if demand.quantity == 0:
            reasons.append(f"Demand {demand.id} has quantity 0.")
        elif demand.min_quantity > demand.quantity:
            reasons.append(
                f"Demand {demand.id} has min_quantity {demand.min_quantity} greater than its "
                f"quantity {demand.quantity}, so it can never be served."
            )
        elif demand.id not in with_edges_d:
            reasons.append(f"Demand {demand.id} has no edges from any supply.")
    return reasons


def _solver(remaining_s: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(remaining_s, MIN_STAGE_SECONDS)
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = SEED
    return solver


def _solve(
    usable: list[_UsableEdge],
    supplies: dict[str, Supply],
    demands: dict[str, Demand],
    time_limit_s: float,
) -> tuple[AllocationStatus, list[int]]:
    """Return (status, quantity per usable edge). Status: OPTIMAL | FEASIBLE | TIMEOUT."""
    model = cp_model.CpModel()
    xs: list[cp_model.IntVar] = []
    ys: list[cp_model.IntVar] = []
    by_supply: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    by_demand: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for i, item in enumerate(usable):
        x = model.new_int_var(0, item.cap, f"x{i}")
        y = model.new_bool_var(f"y{i}")
        model.add(x <= item.cap * y)
        model.add(x >= demands[item.edge.demand_id].min_quantity * y)
        xs.append(x)
        ys.append(y)
        by_supply[item.edge.supply_id].append(x)
        by_demand[item.edge.demand_id].append(x)
    for supply_id, edge_vars in by_supply.items():
        model.add(sum(edge_vars) <= supplies[supply_id].quantity)
    for demand_id, edge_vars in by_demand.items():
        model.add(sum(edge_vars) <= demands[demand_id].quantity)

    total = sum(xs)
    weighted = sum(round(item.edge.score * 100) * x for item, x in zip(usable, xs, strict=True))
    pickups = sum(ys)

    deadline = time.monotonic() + time_limit_s
    stages = (
        ("max", total),
        ("max", weighted),
        ("min", pickups),
    )
    best: list[int] | None = None
    all_optimal = True
    for direction, objective in stages:
        remaining = deadline - time.monotonic()
        if best is not None and remaining < MIN_STAGE_SECONDS:
            all_optimal = False
            break
        if direction == "max":
            model.maximize(objective)
        else:
            model.minimize(objective)
        solver = _solver(remaining)
        status = solver.solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if status == cp_model.UNKNOWN:  # time limit reached without a new solution
                if best is None:
                    return "TIMEOUT", []
                all_optimal = False
                break
            raise AppError(500, "INTERNAL_ERROR", "Allocation model could not be solved.")
        best = [int(solver.value(x)) for x in xs]
        if status != cp_model.OPTIMAL:
            all_optimal = False
        # Fix this level at the achieved value and warm-start the next stage.
        achieved = int(solver.value(objective))
        model.add(objective >= achieved if direction == "max" else objective <= achieved)
        model.clear_hints()
        for x, value in zip(xs, best, strict=True):
            model.add_hint(x, value)
        if status != cp_model.OPTIMAL:
            break
    assert best is not None  # noqa: S101 - set by the first successful stage
    return ("OPTIMAL" if all_optimal else "FEASIBLE"), best


def _leftover_reasons(
    request: AllocateFoodRequest,
    usable: list[_UsableEdge],
    used_supply: dict[str, int],
    used_demand: dict[str, int],
) -> list[str]:
    reasons: list[str] = []
    total_supply = sum(s.quantity for s in request.supplies)
    total_demand = sum(d.quantity for d in request.demands)
    if total_supply < total_demand:
        reasons.append(
            f"Total supply {total_supply} is less than total demand {total_demand}, so at least "
            f"{total_demand - total_supply} cannot be met."
        )
    supplies = {s.id: s for s in request.supplies}
    demands_by_supply: dict[str, list[str]] = defaultdict(list)
    supplies_by_demand: dict[str, list[str]] = defaultdict(list)
    for item in usable:
        demands_by_supply[item.edge.supply_id].append(item.edge.demand_id)
        supplies_by_demand[item.edge.demand_id].append(item.edge.supply_id)
    for demand in request.demands:
        unmet = demand.quantity - used_demand[demand.id]
        connected = supplies_by_demand.get(demand.id, [])
        if unmet <= 0 or not connected:
            continue
        spare = sum(supplies[s].quantity - used_supply[s] for s in connected)
        if spare == 0:
            reasons.append(
                f"Demand {demand.id}: {unmet} unmet because its connected supplies "
                f"({', '.join(connected)}) are fully allocated."
            )
        else:
            reasons.append(
                f"Demand {demand.id}: {unmet} unmet; the {spare} left on its connected supplies "
                f"is either below its minimum of {demand.min_quantity} or limited by edge caps."
            )
    for supply in request.supplies:
        left = supply.quantity - used_supply[supply.id]
        if left > 0 and demands_by_supply.get(supply.id):
            reasons.append(
                f"Supply {supply.id}: {left} left because its connected demands are met, capped, "
                "or need more than is left (minimum quantities)."
            )
    return reasons


def allocate_food(request: AllocateFoodRequest) -> AllocateFoodResponse:
    supplies = {s.id: s for s in request.supplies}
    demands = {d.id: d for d in request.demands}
    reasons = _structural_reasons(request, supplies, demands)
    usable = _prepare_edges(request, supplies, demands, reasons)

    status: AllocationStatus = "NO_FEASIBLE_ALLOCATION"
    quantities: list[int] = []
    if usable:
        status, quantities = _solve(usable, supplies, demands, request.time_limit_s)

    allocations = [
        Allocation(supply_id=item.edge.supply_id, demand_id=item.edge.demand_id, quantity=qty)
        for item, qty in zip(usable, quantities, strict=False)
        if qty > 0
    ]
    used_supply: dict[str, int] = defaultdict(int)
    used_demand: dict[str, int] = defaultdict(int)
    for allocation in allocations:
        used_supply[allocation.supply_id] += allocation.quantity
        used_demand[allocation.demand_id] += allocation.quantity
    total = sum(a.quantity for a in allocations)

    if status in ("OPTIMAL", "FEASIBLE") and total == 0:
        status = "NO_FEASIBLE_ALLOCATION"
    if status == "TIMEOUT":
        reasons.append(
            f"The solver found no allocation within the {request.time_limit_s:g} s time limit."
        )
    reasons.extend(_leftover_reasons(request, usable, used_supply, used_demand))
    if status == "NO_FEASIBLE_ALLOCATION" and not reasons:
        reasons.append("No usable supply-demand edge has enough quantity for its minimum.")

    unallocated = [
        Remaining(id=s.id, quantity=s.quantity - used_supply[s.id]) for s in request.supplies
    ]
    unmet = [
        Remaining(id=d.id, quantity=d.quantity - used_demand[d.id])
        for d in request.demands
        if d.quantity - used_demand[d.id] > 0
    ]
    return AllocateFoodResponse(
        status=status,
        allocations=allocations,
        total_allocated=total,
        unallocated_supply=unallocated,
        unmet_demand=unmet,
        explanation=_explanation(request, status, total, allocations, unmet, reasons),
        reasons=reasons[:MAX_REASONS],
    )


def _explanation(
    request: AllocateFoodRequest,
    status: AllocationStatus,
    total: int,
    allocations: list[Allocation],
    unmet: list[Remaining],
    reasons: list[str],
) -> str:
    total_supply = sum(s.quantity for s in request.supplies)
    if status == "NO_FEASIBLE_ALLOCATION":
        first = reasons[0] if reasons else "no edge can carry a valid quantity."
        return f"No allocation is possible. {first}"
    if status == "TIMEOUT":
        return "No allocation was found within the time limit; try a longer time_limit_s."
    met = len(request.demands) - len(unmet)
    quality = (
        "This plan is optimal for all three priorities."
        if status == "OPTIMAL"
        else "The time limit was reached, so this plan is feasible but may not be optimal."
    )
    return (
        f"Recommend allocating {total} of {total_supply} available units over "
        f"{len(allocations)} supply-demand pair(s), fully meeting {met} of "
        f"{len(request.demands)} demands. Priorities: most total quantity, then higher match "
        f"scores, then fewer pickups. {quality} This is a recommendation; the backend "
        "validates it and a person confirms before anything is reserved."
    )
