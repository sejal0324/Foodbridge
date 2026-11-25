"""POST /ai/optimize-route (single-vehicle VRPTW)."""

from __future__ import annotations

import itertools
import random
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import AUTH


def loc(
    id_: str,
    type_: str = "PICKUP",
    demand: int = 0,
    ws: int | None = None,
    we: int | None = None,
    service: int = 0,
) -> dict[str, Any]:
    return {
        "id": id_,
        "type": type_,
        "demand": demand,
        "window_start_s": ws,
        "window_end_s": we,
        "service_time_s": service,
    }


EXAMPLE = {
    "locations": [
        loc("start", "START"),
        loc("p1", demand=40, ws=0, we=5400, service=600),
        loc("end", "END"),
    ],
    "start_index": 0,
    "end_index": 2,
    "vehicle_capacity": 120,
    "duration_matrix_s": [[0, 900, 1200], [900, 0, 800], [1200, 800, 0]],
    "distance_matrix_m": [[0, 5000, 7000], [5000, 0, 4000], [7000, 4000, 0]],
    "distance_source": "STRAIGHT_LINE_ESTIMATE",
    "time_limit_s": 5,
}


def optimize(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/ai/optimize-route", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def square(n: int, value: int) -> list[list[int]]:
    return [[0 if i == j else value for j in range(n)] for i in range(n)]


def check_route(body: dict[str, Any], result: dict[str, Any]) -> None:
    by_id = {loc_["id"]: (i, loc_) for i, loc_ in enumerate(body["locations"])}
    route = result["route"]
    assert [s["sequence"] for s in route] == list(range(len(route)))
    assert route[0]["location_id"] == body["locations"][body["start_index"]]["id"]
    assert route[-1]["location_id"] == body["locations"][body["end_index"]]["id"]
    for stop in route:
        _, location = by_id[stop["location_id"]]
        assert stop["load_after"] <= body["vehicle_capacity"]
        if location["window_start_s"] is not None:
            assert stop["arrival_s"] >= location["window_start_s"]
        if location["window_end_s"] is not None:
            assert stop["arrival_s"] <= location["window_end_s"]
    for prev, nxt in itertools.pairwise(route):
        i, _ = by_id[prev["location_id"]]
        j, _ = by_id[nxt["location_id"]]
        assert nxt["arrival_s"] >= prev["departure_s"] + body["duration_matrix_s"][i][j]
    visited = {s["location_id"] for s in route}
    dropped = {d["location_id"] for d in result["dropped"]}
    pickups = {loc_["id"] for loc_ in body["locations"] if loc_["type"] == "PICKUP"}
    assert visited & pickups | dropped == pickups
    assert not visited & dropped


def test_example_route(client: TestClient) -> None:
    result = optimize(client, EXAMPLE)
    assert result["status"] == "OPTIMAL"
    assert result["route"] == [
        {"location_id": "start", "sequence": 0, "arrival_s": 0, "departure_s": 0, "load_after": 0},
        {
            "location_id": "p1",
            "sequence": 1,
            "arrival_s": 900,
            "departure_s": 1500,
            "load_after": 40,
        },
        {
            "location_id": "end",
            "sequence": 2,
            "arrival_s": 2300,
            "departure_s": 2300,
            "load_after": 40,
        },
    ]
    assert result["total_distance_m"] == 9000
    assert result["total_duration_s"] == 2300
    assert result["dropped"] == []
    assert result["distance_source"] == "STRAIGHT_LINE_ESTIMATE"
    assert "straight-line estimates, not road data" in result["explanation"]
    assert any("straight-line estimates" in r for r in result["reasons"])


def test_road_data_has_no_estimate_disclaimer(client: TestClient) -> None:
    result = optimize(client, {**EXAMPLE, "distance_source": "ROAD_GOOGLE_ROUTES"})
    assert result["distance_source"] == "ROAD_GOOGLE_ROUTES"
    assert "estimate" not in result["explanation"]


def test_capacity_drop_reason(client: TestClient) -> None:
    body = {
        "locations": [loc("s", "START"), loc("a", demand=80), loc("b", demand=80), loc("e", "END")],
        "start_index": 0,
        "end_index": 3,
        "vehicle_capacity": 120,
        "duration_matrix_s": square(4, 600),
        "distance_matrix_m": square(4, 3000),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    result = optimize(client, body)
    assert result["status"] == "PARTIAL"
    assert len(result["dropped"]) == 1
    assert "total demand 160 exceeds vehicle capacity 120" in result["dropped"][0]["reason"]
    check_route(body, result)


def test_single_stop_over_capacity(client: TestClient) -> None:
    body = {
        "locations": [
            loc("s", "START"),
            loc("big", demand=150),
            loc("ok", demand=30),
            loc("e", "END"),
        ],
        "start_index": 0,
        "end_index": 3,
        "vehicle_capacity": 120,
        "duration_matrix_s": square(4, 600),
        "distance_matrix_m": square(4, 3000),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    result = optimize(client, body)
    assert result["dropped"] == [
        {"location_id": "big", "reason": "demand 150 exceeds vehicle capacity 120"}
    ]


def test_time_window_drop_reason(client: TestClient) -> None:
    body = {
        "locations": [
            loc("s", "START"),
            loc("late", demand=10, ws=0, we=500),
            loc("fine", demand=10, ws=0, we=5000),
            loc("e", "END"),
        ],
        "start_index": 0,
        "end_index": 3,
        "vehicle_capacity": 120,
        "duration_matrix_s": square(4, 900),
        "distance_matrix_m": square(4, 5000),
        "distance_source": "STRAIGHT_LINE_ESTIMATE",
    }
    result = optimize(client, body)
    assert result["status"] == "PARTIAL"
    assert result["dropped"] == [
        {
            "location_id": "late",
            "reason": "time window ends before earliest possible arrival (900s > 500s)",
        }
    ]
    assert any(r.startswith("Dropped late:") for r in result["reasons"])
    check_route(body, result)


def test_conflicting_windows_drop_one_stop(client: TestClient) -> None:
    # Both stops must be served at exactly t=600 but are 600 s apart.
    body = {
        "locations": [
            loc("s", "START"),
            loc("a", demand=10, ws=600, we=600),
            loc("b", demand=20, ws=600, we=600),
            loc("e", "END"),
        ],
        "start_index": 0,
        "end_index": 3,
        "vehicle_capacity": 100,
        "duration_matrix_s": square(4, 600),
        "distance_matrix_m": square(4, 1000),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    result = optimize(client, body)
    assert result["status"] == "PARTIAL"
    # The larger pickup is kept; the other cannot fit in the route.
    assert [d["location_id"] for d in result["dropped"]] == ["a"]
    assert "no position in the route" in result["dropped"][0]["reason"]


def test_waiting_and_delayed_departure(client: TestClient) -> None:
    body = {
        "locations": [
            loc("s", "START"),
            loc("a", demand=5, ws=3600, we=4000, service=300),
            loc("e", "END"),
        ],
        "start_index": 0,
        "end_index": 2,
        "vehicle_capacity": 10,
        "duration_matrix_s": square(3, 900),
        "distance_matrix_m": square(3, 5000),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    route = optimize(client, body)["route"]
    # Departure is delayed so the vehicle arrives as the window opens.
    assert route[0]["departure_s"] == 2700
    assert route[1]["arrival_s"] == 3600
    assert route[2]["arrival_s"] == 3600 + 300 + 900


def test_round_trip_start_equals_end(client: TestClient) -> None:
    body = {
        "locations": [loc("depot", "START"), loc("a", demand=5), loc("b", demand=5)],
        "start_index": 0,
        "end_index": 0,
        "vehicle_capacity": 50,
        "duration_matrix_s": [[0, 100, 300], [100, 0, 150], [300, 150, 0]],
        "distance_matrix_m": [[0, 1000, 3000], [1000, 0, 1500], [3000, 1500, 0]],
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    result = optimize(client, body)
    ids = [s["location_id"] for s in result["route"]]
    assert ids[0] == ids[-1] == "depot" and sorted(ids[1:-1]) == ["a", "b"]
    assert result["status"] == "OPTIMAL"
    assert result["total_distance_m"] == 1000 + 1500 + 3000


def test_infeasible_when_nothing_can_be_served(client: TestClient) -> None:
    body = {
        "locations": [loc("s", "START"), loc("a", demand=10, ws=0, we=100), loc("e", "END")],
        "start_index": 0,
        "end_index": 2,
        "vehicle_capacity": 50,
        "duration_matrix_s": square(3, 600),
        "distance_matrix_m": square(3, 1000),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    result = optimize(client, body)
    assert result["status"] == "INFEASIBLE"
    assert result["dropped"][0]["reason"].startswith("time window ends before")


def test_infeasible_end_window(client: TestClient) -> None:
    body = {
        "locations": [loc("s", "START"), loc("a", demand=10), loc("e", "END", we=100)],
        "start_index": 0,
        "end_index": 2,
        "vehicle_capacity": 50,
        "duration_matrix_s": square(3, 600),
        "distance_matrix_m": square(3, 1000),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    result = optimize(client, body)
    assert result["status"] == "INFEASIBLE"
    assert result["route"] == []
    assert "direct trip from start to end" in result["explanation"]


@pytest.mark.parametrize("seed", range(4))
def test_random_instances_are_feasible_and_deterministic(client: TestClient, seed: int) -> None:
    rng = random.Random(seed)
    n = 25
    points = [(rng.uniform(0, 15000), rng.uniform(0, 15000)) for _ in range(n)]
    dist = [[int(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5) for b in points] for a in points]
    locations = [loc("s", "START")]
    for i in range(1, n - 1):
        start = rng.randint(0, 4000)
        locations.append(
            loc(
                f"p{i}",
                demand=rng.randint(5, 40),
                ws=start,
                we=start + rng.randint(1200, 9000),
                service=300,
            )
        )
    locations.append(loc("e", "END"))
    body = {
        "locations": locations,
        "start_index": 0,
        "end_index": n - 1,
        "vehicle_capacity": 250,
        "duration_matrix_s": [[d * 60 // 500 for d in row] for row in dist],  # 30 km/h
        "distance_matrix_m": dist,
        "distance_source": "STRAIGHT_LINE_ESTIMATE",
        "time_limit_s": 5,
    }
    first = optimize(client, body)
    check_route(body, first)
    assert first["status"] in ("OPTIMAL", "FEASIBLE", "PARTIAL")
    assert first == optimize(client, body)


# --------------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(duration_matrix_s=[[0, 1], [1, 0]]),  # 2x2 for 3 locations
        lambda b: b.update(distance_matrix_m=[[0, 1, 2], [1, 0], [2, 1, 0]]),  # ragged
        lambda b: b["duration_matrix_s"][0].__setitem__(1, -5),  # negative
        lambda b: b.update(start_index=5),
        lambda b: b.update(start_index=1),  # PICKUP at start_index
        lambda b: b["locations"][2].update(type="PICKUP"),  # end is not END
        lambda b: b["locations"][1].update(window_start_s=600, window_end_s=500),
        lambda b: b["locations"].append(dict(b["locations"][1])),  # duplicate id
        lambda b: b.update(time_limit_s=0),
        lambda b: b.update(distance_source="MAGIC"),
    ],
)
def test_invalid_requests_are_422(client: TestClient, mutate: Any) -> None:
    body = {
        **EXAMPLE,
        "locations": [dict(x) for x in EXAMPLE["locations"]],
        "duration_matrix_s": [list(r) for r in EXAMPLE["duration_matrix_s"]],
        "distance_matrix_m": [list(r) for r in EXAMPLE["distance_matrix_m"]],
    }
    mutate(body)
    response = client.post("/ai/optimize-route", json=body, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_more_than_60_locations_is_422(client: TestClient) -> None:
    n = 61
    body = {
        "locations": [loc("s", "START"), *[loc(f"p{i}") for i in range(1, n - 1)], loc("e", "END")],
        "start_index": 0,
        "end_index": n - 1,
        "vehicle_capacity": 10,
        "duration_matrix_s": square(n, 10),
        "distance_matrix_m": square(n, 10),
        "distance_source": "ROAD_GOOGLE_ROUTES",
    }
    assert client.post("/ai/optimize-route", json=body, headers=AUTH).status_code == 422
