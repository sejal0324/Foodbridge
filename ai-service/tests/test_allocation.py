"""POST /ai/allocate-food (CP-SAT)."""

from __future__ import annotations

import itertools
import random
from collections import defaultdict
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import AUTH


def allocate(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/ai/allocate-food", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def as_map(result: dict[str, Any]) -> dict[tuple[str, str], int]:
    return {(a["supply_id"], a["demand_id"]): a["quantity"] for a in result["allocations"]}


def check_constraints(body: dict[str, Any], result: dict[str, Any]) -> None:
    supplies = {s["id"]: s["quantity"] for s in body["supplies"]}
    demands = {d["id"]: d for d in body["demands"]}
    edges = {(e["supply_id"], e["demand_id"]): e for e in body["edges"]}
    used_s: dict[str, int] = defaultdict(int)
    used_d: dict[str, int] = defaultdict(int)
    for (s, d), qty in as_map(result).items():
        assert (s, d) in edges, "allocation on an edge that was not provided"
        assert qty >= demands[d].get("min_quantity", 1)
        cap = edges[(s, d)].get("max_quantity")
        if cap is not None:
            assert qty <= cap
        used_s[s] += qty
        used_d[d] += qty
    for s, qty in supplies.items():
        assert used_s[s] <= qty
    for d, demand in demands.items():
        assert used_d[d] <= demand["quantity"]
    assert result["total_allocated"] == sum(used_s.values())
    remaining = {r["id"]: r["quantity"] for r in result["unallocated_supply"]}
    assert remaining == {s: qty - used_s[s] for s, qty in supplies.items()}
    unmet = {r["id"]: r["quantity"] for r in result["unmet_demand"]}
    assert unmet == {
        d: v["quantity"] - used_d[d] for d, v in demands.items() if v["quantity"] - used_d[d] > 0
    }


def brute_force_max_total(body: dict[str, Any]) -> int:
    """Exhaustive optimum of total quantity for tiny instances."""
    edges = body["edges"]
    supplies = {s["id"]: s["quantity"] for s in body["supplies"]}
    demands = {d["id"]: d for d in body["demands"]}
    ranges = []
    for e in edges:
        cap = min(supplies[e["supply_id"]], demands[e["demand_id"]]["quantity"])
        if e.get("max_quantity") is not None:
            cap = min(cap, e["max_quantity"])
        low = demands[e["demand_id"]].get("min_quantity", 1)
        ranges.append([0, *range(low, cap + 1)])
    best = 0
    for combo in itertools.product(*ranges):
        used_s: dict[str, int] = defaultdict(int)
        used_d: dict[str, int] = defaultdict(int)
        for e, q in zip(edges, combo, strict=True):
            used_s[e["supply_id"]] += q
            used_d[e["demand_id"]] += q
        if all(used_s[s] <= supplies[s] for s in supplies) and all(
            used_d[d] <= demands[d]["quantity"] for d in demands
        ):
            best = max(best, sum(combo))
    return best


EXAMPLE = {
    "supplies": [{"id": "s1", "quantity": 100}],
    "demands": [
        {"id": "d1", "quantity": 20, "min_quantity": 1},
        {"id": "d2", "quantity": 50, "min_quantity": 10},
        {"id": "d3", "quantity": 60, "min_quantity": 1},
    ],
    "edges": [
        {"supply_id": "s1", "demand_id": "d1", "score": 80.5, "max_quantity": None},
        {"supply_id": "s1", "demand_id": "d2", "score": 75.0, "max_quantity": None},
        {"supply_id": "s1", "demand_id": "d3", "score": 60.0, "max_quantity": None},
    ],
    "time_limit_s": 5,
}


def test_example_allocates_everything_by_score(client: TestClient) -> None:
    result = allocate(client, EXAMPLE)
    assert result["status"] == "OPTIMAL"
    assert result["total_allocated"] == 100
    assert as_map(result) == {("s1", "d1"): 20, ("s1", "d2"): 50, ("s1", "d3"): 30}
    assert result["unallocated_supply"] == [{"id": "s1", "quantity": 0}]
    assert result["unmet_demand"] == [{"id": "d3", "quantity": 30}]
    assert "recommendation" in result["explanation"]
    check_constraints(EXAMPLE, result)


def test_maximises_total_before_score(client: TestClient) -> None:
    body = {
        "supplies": [{"id": "s", "quantity": 10}],
        "demands": [
            {"id": "high", "quantity": 7, "min_quantity": 7},
            {"id": "low1", "quantity": 5, "min_quantity": 5},
            {"id": "low2", "quantity": 5, "min_quantity": 5},
        ],
        "edges": [
            {"supply_id": "s", "demand_id": "high", "score": 100},
            {"supply_id": "s", "demand_id": "low1", "score": 10},
            {"supply_id": "s", "demand_id": "low2", "score": 10},
        ],
    }
    result = allocate(client, body)
    # Giving 7 to "high" strands 3 units (below the minimum of 5 elsewhere).
    assert result["total_allocated"] == 10
    assert as_map(result) == {("s", "low1"): 5, ("s", "low2"): 5}


def test_prefers_higher_scores_when_total_ties(client: TestClient) -> None:
    body = {
        "supplies": [{"id": "s", "quantity": 10}],
        "demands": [{"id": "a", "quantity": 10}, {"id": "b", "quantity": 10}],
        "edges": [
            {"supply_id": "s", "demand_id": "a", "score": 60},
            {"supply_id": "s", "demand_id": "b", "score": 80},
        ],
    }
    assert as_map(allocate(client, body)) == {("s", "b"): 10}


def test_prefers_fewer_pickups_when_total_and_score_tie(client: TestClient) -> None:
    body = {
        "supplies": [{"id": "s1", "quantity": 10}, {"id": "s2", "quantity": 10}],
        "demands": [{"id": "d", "quantity": 10}],
        "edges": [
            {"supply_id": "s1", "demand_id": "d", "score": 50},
            {"supply_id": "s2", "demand_id": "d", "score": 50},
        ],
    }
    result = allocate(client, body)
    assert result["total_allocated"] == 10
    assert len(result["allocations"]) == 1


def test_edge_caps_and_min_quantity(client: TestClient) -> None:
    body = {
        "supplies": [{"id": "s", "quantity": 100}],
        "demands": [
            {"id": "d1", "quantity": 80, "min_quantity": 30},
            {"id": "d2", "quantity": 80, "min_quantity": 25},
        ],
        "edges": [
            {"supply_id": "s", "demand_id": "d1", "score": 90, "max_quantity": 40},
            {"supply_id": "s", "demand_id": "d2", "score": 50, "max_quantity": 20},
        ],
    }
    result = allocate(client, body)
    # d2's edge cap (20) is below its minimum (25): unusable.
    assert as_map(result) == {("s", "d1"): 40}
    assert any("below demand d2's minimum of 25" in reason for reason in result["reasons"])
    check_constraints(body, result)


@pytest.mark.parametrize("seed", range(6))
def test_random_instances_respect_constraints_and_are_optimal(
    client: TestClient, seed: int
) -> None:
    rng = random.Random(seed)
    supplies = [{"id": f"s{i}", "quantity": rng.randint(0, 6)} for i in range(2)]
    demands = [
        {"id": f"d{i}", "quantity": rng.randint(1, 5), "min_quantity": rng.randint(1, 3)}
        for i in range(3)
    ]
    edges = [
        {
            "supply_id": s["id"],
            "demand_id": d["id"],
            "score": rng.randint(0, 100),
            "max_quantity": rng.choice([None, 2, 4]),
        }
        for s in supplies
        for d in demands
        if rng.random() < 0.8
    ]
    body = {"supplies": supplies, "demands": demands, "edges": edges}
    result = allocate(client, body)
    check_constraints(body, result)
    assert result["total_allocated"] == brute_force_max_total(body)


def test_deterministic(client: TestClient) -> None:
    rng = random.Random(3)
    body = {
        "supplies": [{"id": f"s{i}", "quantity": rng.randint(10, 80)} for i in range(15)],
        "demands": [
            {"id": f"d{i}", "quantity": rng.randint(5, 60), "min_quantity": rng.randint(1, 10)}
            for i in range(25)
        ],
        "edges": [],
    }
    for s in body["supplies"]:
        for d in body["demands"]:
            if rng.random() < 0.3:
                body["edges"].append(
                    {
                        "supply_id": s["id"],
                        "demand_id": d["id"],
                        "score": round(rng.uniform(0, 100), 2),
                    }
                )
    first = allocate(client, body)
    assert first == allocate(client, body)
    check_constraints(body, first)


# --------------------------------------------------------------------------- infeasible


def test_no_edges_explains_why(client: TestClient) -> None:
    body = {**EXAMPLE, "edges": []}
    result = allocate(client, body)
    assert result["status"] == "NO_FEASIBLE_ALLOCATION"
    assert result["allocations"] == [] and result["total_allocated"] == 0
    assert "No edges were provided" in result["explanation"]


def test_min_quantity_above_supply_explains_why(client: TestClient) -> None:
    body = {
        "supplies": [{"id": "s", "quantity": 8}],
        "demands": [{"id": "d", "quantity": 50, "min_quantity": 10}],
        "edges": [{"supply_id": "s", "demand_id": "d", "score": 90}],
    }
    result = allocate(client, body)
    assert result["status"] == "NO_FEASIBLE_ALLOCATION"
    assert "can carry at most 8, below demand d's minimum of 10" in result["reasons"][0]
    assert result["unmet_demand"] == [{"id": "d", "quantity": 50}]


def test_unconnected_nodes_are_reported(client: TestClient) -> None:
    body = {
        "supplies": [{"id": "s1", "quantity": 5}, {"id": "s2", "quantity": 5}],
        "demands": [{"id": "d1", "quantity": 5}, {"id": "d2", "quantity": 5}],
        "edges": [{"supply_id": "s1", "demand_id": "d1", "score": 50}],
    }
    reasons = allocate(client, body)["reasons"]
    assert "Supply s2 has no edges to any demand." in reasons
    assert "Demand d2 has no edges from any supply." in reasons


# --------------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["supplies"].append({"id": "s1", "quantity": 1}),  # duplicate supply id
        lambda b: b["demands"].append({"id": "d1", "quantity": 1}),  # duplicate demand id
        lambda b: b["edges"].append({"supply_id": "zz", "demand_id": "d1", "score": 1}),
        lambda b: b["edges"].append({"supply_id": "s1", "demand_id": "zz", "score": 1}),
        lambda b: b["edges"].append(dict(b["edges"][0])),  # duplicate edge
        lambda b: b.update(time_limit_s=11),
        lambda b: b["supplies"][0].update(quantity=-1),
        lambda b: b["edges"][0].update(score=101),
    ],
)
def test_invalid_requests_are_422(client: TestClient, mutate: Any) -> None:
    body = {
        "supplies": [dict(s) for s in EXAMPLE["supplies"]],
        "demands": [dict(d) for d in EXAMPLE["demands"]],
        "edges": [dict(e) for e in EXAMPLE["edges"]],
    }
    mutate(body)
    response = client.post("/ai/allocate-food", json=body, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
