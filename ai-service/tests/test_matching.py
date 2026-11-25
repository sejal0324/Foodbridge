"""POST /ai/match-ngos and /ai/match-donors: formulas, ranking, explanations."""

from __future__ import annotations

import copy
import random
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import AUTH

WEIGHTS = {
    "distance": 20,
    "food_requirement": 20,
    "quantity_capacity": 15,
    "food_preference": 10,
    "urgency": 15,
    "pickup_availability": 10,
    "reliability": 5,
    "beneficiary_demand": 5,
}


def ngo(**overrides: Any) -> dict[str, Any]:
    candidate: dict[str, Any] = {
        "ngo_id": "ngo-1",
        "name": "Helping Hands",
        "distance_m": 3200,
        "distance_source": "STRAIGHT_LINE_ESTIMATE",
        "travel_time_s": None,
        "collection_radius_m": 10000,
        "capacity_remaining": 150,
        "open_need": {
            "quantity_remaining": 100,
            "urgency": "HIGH",
            "dietary_requirement": "VEG_ONLY",
        },
        "has_refrigeration": False,
        "accepts_veg": True,
        "accepts_non_veg": False,
        "reliability": {"completed": 12, "failed": 1},
        "beneficiaries_count": 180,
    }
    candidate.update(overrides)
    return candidate


def donation(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "id": "don-1",
        "category_code": "COOKED_MEALS",
        "dietary_type": "VEG",
        "quantity_available": 120,
        "unit": "MEALS",
        "storage_type": "HOT_HELD",
        "requires_refrigeration": False,
        "minutes_until_deadline": 180,
    }
    value.update(overrides)
    return value


def match_ngos(
    client: TestClient,
    candidates: list[dict],
    weights: dict | None = None,
    **donation_overrides: Any,
) -> dict[str, Any]:
    body = {
        "donation": donation(**donation_overrides),
        "candidates": candidates,
        "weights": weights or WEIGHTS,
    }
    response = client.post("/ai/match-ngos", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def criterion(result: dict, name: str) -> float:
    return result["criteria"][name]["score"]


# --------------------------------------------------------------------------- NGO formulas


def test_example_scores_and_total(client: TestClient) -> None:
    body = match_ngos(client, [ngo()])
    assert body["algorithm_version"] == "weighted-v1"
    result = body["results"][0]
    assert result["candidate_id"] == "ngo-1" and result["rank"] == 1
    # Hand-computed criteria.
    expected = {
        "distance": 68.0,  # 100 * (1 - 3200/10000)
        "food_requirement": 100.0,  # open need present
        "quantity_capacity": 100.0,  # min(1, 150/120)
        "food_preference": 100.0,  # HOT_HELD, no cold chain
        "urgency": 75.0,  # HIGH
        "pickup_availability": 100.0,  # travel 9.6 min, slack 170.4 >= 120
        "reliability": 92.31,  # 12/13
        "beneficiary_demand": 100.0,  # only candidate
    }
    for name, value in expected.items():
        assert criterion(result, name) == pytest.approx(value, abs=0.005), name
    raw = 13.6 + 20 + 15 + 10 + 11.25 + 10 + 5 * 12 / 13 + 5
    assert result["score"] == round(raw, 2) == 89.47
    distance = result["criteria"]["distance"]
    assert distance == {
        "score": 68.0,
        "weight": 20,
        "contribution": 13.6,
        "detail": "3.2 km (straight-line estimate) of 10 km radius",
    }
    assert result["criteria"]["reliability"]["contribution"] == 4.62


def test_distance_beyond_radius_scores_zero(client: TestClient) -> None:
    result = match_ngos(client, [ngo(distance_m=12000)])["results"][0]
    assert criterion(result, "distance") == 0.0


def test_food_requirement_and_urgency_without_open_need(client: TestClient) -> None:
    result = match_ngos(client, [ngo(open_need=None)])["results"][0]
    assert criterion(result, "food_requirement") == 60.0
    assert criterion(result, "urgency") == 10.0


@pytest.mark.parametrize(
    ("urgency", "score"), [("CRITICAL", 100.0), ("HIGH", 75.0), ("MEDIUM", 50.0), ("LOW", 25.0)]
)
def test_urgency_mapping(client: TestClient, urgency: str, score: float) -> None:
    need = {"quantity_remaining": 10, "urgency": urgency, "dietary_requirement": "ANY"}
    result = match_ngos(client, [ngo(open_need=need)])["results"][0]
    assert criterion(result, "urgency") == score


def test_quantity_capacity(client: TestClient) -> None:
    partial = match_ngos(client, [ngo(capacity_remaining=60)])["results"][0]
    assert criterion(partial, "quantity_capacity") == 50.0  # 60/120
    unknown = match_ngos(client, [ngo(capacity_remaining=None)])["results"][0]
    assert criterion(unknown, "quantity_capacity") == 50.0
    assert any("capacity unknown" in text.lower() for text in unknown["limitations"])


def test_handling_fit_cold_chain(client: TestClient) -> None:
    no_fridge = match_ngos(client, [ngo()], storage_type="REFRIGERATED")["results"][0]
    assert criterion(no_fridge, "food_preference") == 40.0
    assert any("NGO has no refrigeration" in text for text in no_fridge["limitations"])
    flagged = match_ngos(client, [ngo(has_refrigeration=True)], requires_refrigeration=True)
    assert criterion(flagged["results"][0], "food_preference") == 100.0
    frozen = match_ngos(client, [ngo()], storage_type="FROZEN")["results"][0]
    assert criterion(frozen, "food_preference") == 40.0


def test_pickup_availability_formula(client: TestClient) -> None:
    # Provided travel time: 1800 s = 30 min; deadline 100 -> slack 70 -> (70-15)/105.
    provided = match_ngos(client, [ngo(travel_time_s=1800)], minutes_until_deadline=100)
    result = provided["results"][0]
    assert criterion(result, "pickup_availability") == pytest.approx(52.38, abs=0.005)
    assert not any("20 km/h" in text for text in result["limitations"])
    # Estimated: 10 km at 20 km/h = 30 min; deadline 44 -> slack 14 -> 0.
    estimated = match_ngos(client, [ngo(distance_m=10000)], minutes_until_deadline=44)
    result = estimated["results"][0]
    assert criterion(result, "pickup_availability") == 0.0
    assert (
        "estimated at 20 km/h urban average" in result["criteria"]["pickup_availability"]["detail"]
    )
    # Slack exactly 120 -> 100.
    full = match_ngos(client, [ngo(travel_time_s=600)], minutes_until_deadline=130)
    assert criterion(full["results"][0], "pickup_availability") == 100.0


def test_reliability_formula(client: TestClient) -> None:
    limited = match_ngos(client, [ngo(reliability={"completed": 2, "failed": 0})])["results"][0]
    assert criterion(limited, "reliability") == 70.0
    assert any("limited history" in text.lower() for text in limited["limitations"])
    known = match_ngos(client, [ngo(reliability={"completed": 9, "failed": 1})])["results"][0]
    assert criterion(known, "reliability") == 90.0


def test_beneficiary_demand_is_relative_to_max(client: TestClient) -> None:
    body = match_ngos(
        client,
        [
            ngo(ngo_id="a", beneficiaries_count=180),
            ngo(ngo_id="b", beneficiaries_count=90),
        ],
    )
    scores = {r["candidate_id"]: criterion(r, "beneficiary_demand") for r in body["results"]}
    assert scores == {"a": 100.0, "b": 50.0}
    zero = match_ngos(client, [ngo(beneficiaries_count=0)])["results"][0]
    assert criterion(zero, "beneficiary_demand") == 0.0


def test_road_distance_has_no_estimate_limitation(client: TestClient) -> None:
    result = match_ngos(client, [ngo(distance_source="ROAD_GOOGLE_ROUTES", travel_time_s=900)])
    first = result["results"][0]
    assert first["limitations"] == []
    assert "(road distance)" in first["criteria"]["distance"]["detail"]


# --------------------------------------------------------------------------- weights


@pytest.mark.parametrize(
    "weights",
    [
        {**WEIGHTS, "distance": 25},  # sums to 105
        {**WEIGHTS, "distance": -5, "food_requirement": 45},  # negative weight
        # A missing key takes its default (15): 35 + 80 - 20 + 15 = 115.
        {k: v for k, v in WEIGHTS.items() if k != "urgency"} | {"distance": 35},
        {**WEIGHTS, "unknown_criterion": 0},  # unknown key
    ],
)
def test_invalid_weights_are_rejected(client: TestClient, weights: dict) -> None:
    body = {"donation": donation(), "candidates": [ngo()], "weights": weights}
    response = client.post("/ai/match-ngos", json=body, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_fractional_weights_summing_to_100_are_accepted(client: TestClient) -> None:
    weights = {**WEIGHTS, "distance": 19.5, "beneficiary_demand": 5.5}
    body = match_ngos(client, [ngo()], weights=weights)
    assert body["weights"]["distance"] == 19.5


def test_weights_are_echoed_and_default_when_omitted(client: TestClient) -> None:
    body = {"donation": donation(), "candidates": [ngo()]}
    response = client.post("/ai/match-ngos", json=body, headers=AUTH).json()
    assert response["weights"] == {k: float(v) for k, v in WEIGHTS.items()}


# --------------------------------------------------------------------------- ranking


def test_sorted_by_score_descending(client: TestClient) -> None:
    body = match_ngos(
        client,
        [
            ngo(ngo_id="far", distance_m=9000),
            ngo(ngo_id="near", distance_m=1000),
            ngo(ngo_id="mid", distance_m=5000),
        ],
    )
    assert [r["candidate_id"] for r in body["results"]] == ["near", "mid", "far"]
    assert [r["rank"] for r in body["results"]] == [1, 2, 3]
    scores = [r["score"] for r in body["results"]]
    assert scores == sorted(scores, reverse=True)


def test_ties_broken_by_distance_then_id(client: TestClient) -> None:
    weights = {**WEIGHTS, "distance": 0, "food_requirement": 40}  # distance no longer scored
    body = match_ngos(
        client,
        [
            ngo(ngo_id="c", distance_m=3000, travel_time_s=600),
            ngo(ngo_id="b", distance_m=2000, travel_time_s=600),
            ngo(ngo_id="a", distance_m=3000, travel_time_s=600),
        ],
        weights=weights,
    )
    assert len({r["score"] for r in body["results"]}) == 1
    assert [r["candidate_id"] for r in body["results"]] == ["b", "a", "c"]


def test_ranking_is_deterministic_and_order_independent(client: TestClient) -> None:
    rng = random.Random(7)
    candidates = [
        ngo(
            ngo_id=f"n{i}",
            name=f"NGO {i}",
            distance_m=rng.randint(100, 9000),
            capacity_remaining=rng.choice([None, 30, 80, 200]),
            beneficiaries_count=rng.randint(0, 400),
            reliability={"completed": rng.randint(0, 20), "failed": rng.randint(0, 3)},
        )
        for i in range(30)
    ]
    first = match_ngos(client, candidates)
    shuffled = copy.deepcopy(candidates)
    rng.shuffle(shuffled)
    second = match_ngos(client, shuffled)
    assert first == second


def test_empty_candidates_and_duplicate_ids(client: TestClient) -> None:
    assert match_ngos(client, [])["results"] == []
    body = {"donation": donation(), "candidates": [ngo(), ngo()], "weights": WEIGHTS}
    assert client.post("/ai/match-ngos", json=body, headers=AUTH).status_code == 422


# --------------------------------------------------------------------------- explanations


def test_explanation_names_strongest_factors(client: TestClient) -> None:
    result = match_ngos(client, [ngo()])["results"][0]
    assert result["explanation"] == (
        "Helping Hands is recommended because it needs 100 vegetarian meals (urgency HIGH), "
        "can take the full quantity and is 3.2 km away (straight-line estimate)."
    )
    assert result["limitations"] == [
        "Distance is a straight-line estimate, not road distance.",
        "Travel time is estimated at 20 km/h urban average, not taken from road data.",
    ]


def test_explanation_mentions_main_drawback(client: TestClient) -> None:
    result = match_ngos(client, [ngo(capacity_remaining=30)])["results"][0]
    assert "Main drawback: it has capacity for only 30 of the 120 meals." in result["explanation"]


def test_explanation_never_mentions_machine_learning(client: TestClient) -> None:
    result = match_ngos(client, [ngo()])["results"][0]
    text = (result["explanation"] + " ".join(result["limitations"])).lower()
    assert "machine learning" not in text and "ai predicts" not in text


# --------------------------------------------------------------------------- donor matching


def donor(**overrides: Any) -> dict[str, Any]:
    candidate: dict[str, Any] = {
        "donor_id": "donor-1",
        "name": "Spice Garden",
        "distance_m": 4100,
        "distance_source": "STRAIGHT_LINE_ESTIMATE",
        "travel_time_s": None,
        "max_radius_m": 10000,
        "available_matching_quantity": 0,
        "predicted_surplus": 35,
        "historical_avg_surplus": 28.5,
        "produces_category": True,
        "availability_overlap_minutes": 120,
        "needed_window_minutes": 120,
        "reliability": {"completed": 4, "failed": 0},
    }
    candidate.update(overrides)
    return candidate


def match_donors(client: TestClient, candidates: list[dict], **request_overrides: Any) -> dict:
    request = {
        "id": "req-1",
        "category_code": "COOKED_MEALS",
        "dietary_requirement": "VEG_ONLY",
        "quantity_remaining": 150,
        "unit": "MEALS",
        "urgency": "HIGH",
        "beneficiaries_count": 150,
        "needed_from": "2026-11-04T06:30:00Z",
        "needed_until": "2026-11-04T08:30:00Z",
    }
    request.update(request_overrides)
    body = {"request": request, "candidates": candidates, "weights": WEIGHTS}
    response = client.post("/ai/match-donors", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def test_donor_example_formulas(client: TestClient) -> None:
    result = match_donors(client, [donor()])["results"][0]
    assert result["candidate_id"] == "donor-1"
    assert criterion(result, "distance") == 59.0  # 1 - 4100/10000
    assert criterion(result, "food_requirement") == 70.0  # produces category
    assert criterion(result, "quantity_capacity") == pytest.approx(23.33, abs=0.005)  # 35/150
    assert criterion(result, "food_preference") == 60.0
    assert criterion(result, "urgency") == 75.0
    assert criterion(result, "pickup_availability") == 100.0
    assert criterion(result, "reliability") == 100.0
    assert criterion(result, "beneficiary_demand") == 75.0  # 150/200
    raw = (
        20 * 59 + 20 * 70 + 15 * 35 / 150 * 100 + 10 * 60 + 15 * 75 + 10 * 100 + 5 * 100 + 5 * 75
    ) / 100
    assert result["score"] == round(raw, 2)
    text = " ".join(result["limitations"])
    assert (
        "Quantity is a forecast/historical estimate — the donor must confirm actual food."
        in result["limitations"]
    )
    assert "Dietary compatibility unconfirmed" in text


def test_donor_explanation_marks_estimates(client: TestClient) -> None:
    result = match_donors(client, [donor()])["results"][0]
    assert result["explanation"] == (
        "Spice Garden is recommended because it regularly produces this food category, is "
        "available for the whole needed window and has completed 4 of 4 past donations. "
        "Main drawback: it is expected to cover only about 35 of the 150 meals needed (an "
        "estimate, not confirmed food). No food is confirmed yet: quantities shown are "
        "estimates, and the donor must confirm actual food before anything is reserved."
    )
    # A forecast that covers the request is named as a strength, still marked as an estimate.
    covered = match_donors(client, [donor(predicted_surplus=200)])["results"][0]
    assert (
        "is forecast to have about 200 meals of surplus (an estimate, not confirmed food)"
        in covered["explanation"]
    )


def test_donor_with_available_food(client: TestClient) -> None:
    result = match_donors(client, [donor(available_matching_quantity=150)])["results"][0]
    assert criterion(result, "food_requirement") == 100.0
    assert criterion(result, "quantity_capacity") == 100.0
    assert criterion(result, "food_preference") == 100.0
    assert "has 150 matching meals available now" in result["explanation"]
    assert not any("forecast/historical" in text for text in result["limitations"])
    assert "No food is confirmed yet" not in result["explanation"]


def test_donor_food_requirement_without_category(client: TestClient) -> None:
    result = match_donors(client, [donor(produces_category=False)])["results"][0]
    assert criterion(result, "food_requirement") == 40.0


def test_donor_no_quantity_evidence(client: TestClient) -> None:
    result = match_donors(client, [donor(predicted_surplus=None, historical_avg_surplus=None)])[
        "results"
    ][0]
    assert criterion(result, "quantity_capacity") == 0.0
    assert any("no quantity evidence" in text.lower() for text in result["limitations"])


def test_donor_historical_estimate(client: TestClient) -> None:
    result = match_donors(client, [donor(predicted_surplus=None)])["results"][0]
    assert criterion(result, "quantity_capacity") == pytest.approx(19.0)  # 28.5/150
    detail = result["criteria"]["quantity_capacity"]["detail"]
    assert detail == "Historical average surplus ~28.5 meals (estimate) for 150 needed"
    assert "about 28.5 of the 150 meals needed (an estimate" in result["explanation"]
    covered = match_donors(client, [donor(predicted_surplus=None, historical_avg_surplus=150)])
    assert (
        "has historically averaged about 150 meals of surplus (an estimate"
        in covered["results"][0]["explanation"]
    )


def test_donor_pickup_availability(client: TestClient) -> None:
    unknown = match_donors(client, [donor(availability_overlap_minutes=None)])["results"][0]
    assert criterion(unknown, "pickup_availability") == 50.0
    assert any(
        "donor availability not configured" in text.lower() for text in unknown["limitations"]
    )
    half = match_donors(client, [donor(availability_overlap_minutes=60)])["results"][0]
    assert criterion(half, "pickup_availability") == 50.0


def test_donor_beneficiary_cap_and_urgency(client: TestClient) -> None:
    result = match_donors(client, [donor()], beneficiaries_count=500, urgency="CRITICAL")
    first = result["results"][0]
    assert criterion(first, "beneficiary_demand") == 100.0
    assert criterion(first, "urgency") == 100.0


def test_donor_ranking_prefers_confirmed_food(client: TestClient) -> None:
    body = match_donors(
        client,
        [
            donor(donor_id="forecast-only"),
            donor(donor_id="has-food", available_matching_quantity=150, distance_m=6000),
        ],
    )
    assert [r["candidate_id"] for r in body["results"]] == ["has-food", "forecast-only"]
