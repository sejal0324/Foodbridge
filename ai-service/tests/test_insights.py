"""POST /ai/insights: computations and sample-size guards."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.services.insights_service import spearman
from tests.conftest import AUTH


def insights(client: TestClient, series: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    body = {"audience": "ADMIN", "data_label": "REAL", "min_sample_size": 20, "series": series}
    body.update(overrides)
    response = client.post("/ai/insights", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def by_type(result: dict[str, Any], kind: str) -> dict[str, Any] | None:
    return next((i for i in result["insights"] if i["type"] == kind), None)


def skipped(result: dict[str, Any], kind: str) -> str | None:
    return next((s["reason"] for s in result["skipped"] if s["type"] == kind), None)


WEEKDAYS = [{"weekday": d, "count": 10, "quantity": 400} for d in range(1, 6)] + [
    {"weekday": 6, "count": 12, "quantity": 600},
    {"weekday": 7, "count": 8, "quantity": 480},
]


def test_weekend_vs_weekday_per_day_averages(client: TestClient) -> None:
    result = insights(client, {"donations_by_weekday": WEEKDAYS})
    insight = by_type(result, "WEEKEND_VS_WEEKDAY")
    assert insight is not None
    data = insight["supporting_data"]
    assert data["weekday_avg_quantity_per_day"] == 400.0  # 2000 / 5
    assert data["weekend_avg_quantity_per_day"] == 540.0  # 1080 / 2
    assert data["difference_pct"] == 35.0
    assert insight["title"] == "Weekend donations are 35% higher than weekdays"
    assert insight["sample_size"] == 70
    assert insight["confidence"] == "MEDIUM"  # 70 >= 2 * 20 but < 5 * 20


def test_sample_guard_skips_small_samples(client: TestClient) -> None:
    small = [
        {"weekday": 1, "count": 4, "quantity": 100},
        {"weekday": 6, "count": 3, "quantity": 90},
    ]
    result = insights(client, {"donations_by_weekday": small})
    assert by_type(result, "WEEKEND_VS_WEEKDAY") is None
    assert skipped(result, "WEEKEND_VS_WEEKDAY") == "insufficient sample (n=7 < 20)"


def test_every_insight_meets_min_sample_size(client: TestClient) -> None:
    series = {
        "donations_by_weekday": WEEKDAYS,
        "unmet_requests_by_category": [
            {
                "category_code": "COOKED_MEALS",
                "dietary_requirement": "VEG_ONLY",
                "open_requests": 5,
                "quantity_remaining": 420,
            }
        ],
        "collections": [{"distance_m": 1000 * i, "delay_minutes": float(i)} for i in range(10)],
        "monthly_completed": [
            {"month": "2026-09", "quantity": 5, "count": 2},
            {"month": "2026-10", "quantity": 6, "count": 3},
        ],
    }
    result = insights(client, series, min_sample_size=50)
    assert [i["type"] for i in result["insights"]] == ["WEEKEND_VS_WEEKDAY"]
    assert all(i["sample_size"] >= 50 for i in result["insights"])
    assert skipped(result, "UNMET_DEMAND") == "insufficient sample (n=5 < 50)"
    assert skipped(result, "DISTANCE_DELAY") == "insufficient sample (n=10 < 50)"
    assert skipped(result, "TREND") == "insufficient sample (n=5 < 50)"


def test_missing_series_are_reported_as_skipped(client: TestClient) -> None:
    result = insights(client, {})
    assert result["insights"] == []
    assert {s["type"] for s in result["skipped"]} == {
        "WEEKEND_VS_WEEKDAY",
        "UNMET_DEMAND",
        "DISTANCE_DELAY",
        "TREND",
    }
    assert all(s["reason"] == "no data provided" for s in result["skipped"])


def test_unmet_demand_top_category(client: TestClient) -> None:
    series = {
        "unmet_requests_by_category": [
            {
                "category_code": "BAKERY",
                "dietary_requirement": "ANY",
                "open_requests": 6,
                "quantity_remaining": 900,
            },
            {
                "category_code": "COOKED_MEALS",
                "dietary_requirement": "VEG_ONLY",
                "open_requests": 18,
                "quantity_remaining": 420,
            },
            {
                "category_code": "COOKED_MEALS",
                "dietary_requirement": "ANY",
                "open_requests": 6,
                "quantity_remaining": 100,
            },
        ]
    }
    insight = by_type(insights(client, series), "UNMET_DEMAND")
    assert insight is not None
    assert insight["title"] == "Most unmet requests are for COOKED_MEALS (VEG_ONLY)"
    assert insight["sample_size"] == 30
    assert insight["supporting_data"]["top"]["share_of_open_requests_pct"] == 60.0
    assert "18 of 30 open requests (60%)" in insight["body"]


def test_spearman_known_values() -> None:
    # No ties: rho = 1 - 6 * sum(d^2) / (n (n^2 - 1)) = 1 - 24/120 = 0.8
    assert spearman(np.array([1.0, 2, 3, 4, 5]), np.array([2.0, 1, 4, 3, 5])) == pytest.approx(0.8)
    # Ties use average ranks: Pearson of [1, 2.5, 2.5, 4] and [1, 2, 3, 4].
    expected = 4.5 / np.sqrt(4.5 * 5.0)
    assert spearman(np.array([1.0, 2, 2, 3]), np.array([1.0, 2, 3, 4])) == pytest.approx(expected)
    # Monotonic but non-linear is still perfect rank correlation.
    x = np.arange(1.0, 30.0)
    assert spearman(x, x**3) == pytest.approx(1.0)
    assert spearman(x, -x) == pytest.approx(-1.0)


def test_distance_delay_correlation_not_causation(client: TestClient) -> None:
    rng = np.random.default_rng(0)
    distance = rng.uniform(500, 15000, size=60)
    delay = distance / 1000 + rng.normal(0, 2, size=60)
    series = {
        "collections": [
            {"distance_m": float(d), "delay_minutes": float(t)}
            for d, t in zip(distance, delay, strict=True)
        ]
    }
    insight = by_type(insights(client, series), "DISTANCE_DELAY")
    assert insight is not None
    rho = insight["supporting_data"]["spearman_rho"]
    assert rho == pytest.approx(spearman(distance, delay), abs=1e-4)
    assert rho > 0.5
    assert "correlation, not causation" in insight["body"]
    assert insight["supporting_data"]["significant_at_95pct_approx"] is True
    assert insight["confidence"] == "MEDIUM"  # significant, n=60 < 5 * 20


def test_distance_delay_without_variation_is_skipped(client: TestClient) -> None:
    series = {"collections": [{"distance_m": 1000, "delay_minutes": float(i)} for i in range(30)]}
    result = insights(client, series)
    assert skipped(result, "DISTANCE_DELAY") == "no variation in distance or delay"


def test_trend_last_vs_previous_month(client: TestClient) -> None:
    series = {
        "monthly_completed": [
            {"month": "2026-07", "quantity": 900, "count": 30},
            {"month": "2026-10", "quantity": 1200, "count": 40},
            {"month": "2026-08", "quantity": 800, "count": 28},
            {"month": "2026-09", "quantity": 1000, "count": 35},
        ]
    }
    insight = by_type(insights(client, series), "TREND")
    assert insight is not None
    assert insight["title"] == "Completed quantity up 20% in 2026-10"
    assert insight["sample_size"] == 75  # 40 + 35 collections
    assert insight["supporting_data"]["previous_3_month_avg"] == 900.0
    assert "1200 units were completed in 2026-10 versus 1000 in 2026-09 (+20%)" in insight["body"]


def test_trend_without_counts_uses_units(client: TestClient) -> None:
    series = {
        "monthly_completed": [
            {"month": "2026-09", "quantity": 100},
            {"month": "2026-10", "quantity": 50},
        ]
    }
    insight = by_type(insights(client, series), "TREND")
    assert insight is not None
    assert insight["title"] == "Completed quantity down 50% in 2026-10"
    assert any("measured in units" in text for text in insight["limitations"])


def test_trend_needs_two_months(client: TestClient) -> None:
    result = insights(client, {"monthly_completed": [{"month": "2026-10", "quantity": 500}]})
    assert skipped(result, "TREND") == "need at least 2 months of data (got 1)"


@pytest.mark.parametrize("label", ["SYNTHETIC", "MIXED"])
def test_non_real_data_is_labelled(client: TestClient, label: str) -> None:
    insight = by_type(
        insights(client, {"donations_by_weekday": WEEKDAYS}, data_label=label), "WEEKEND_VS_WEEKDAY"
    )
    assert insight is not None
    assert any("synthetic/demo data" in text for text in insight["limitations"])


def test_real_data_has_no_synthetic_label(client: TestClient) -> None:
    insight = by_type(insights(client, {"donations_by_weekday": WEEKDAYS}), "WEEKEND_VS_WEEKDAY")
    assert insight is not None
    assert not any("synthetic" in text.lower() for text in insight["limitations"])


@pytest.mark.parametrize(
    "series",
    [
        {"donations_by_weekday": [{"weekday": 0, "count": 1, "quantity": 1}]},
        {"donations_by_weekday": [{"weekday": 8, "count": 1, "quantity": 1}]},
        {"monthly_completed": [{"month": "2026-13", "quantity": 1}]},
        {
            "monthly_completed": [
                {"month": "2026-10", "quantity": 1},
                {"month": "2026-10", "quantity": 2},
            ]
        },
        {"collections": [{"distance_m": -1, "delay_minutes": 0}]},
    ],
)
def test_invalid_series_are_422(client: TestClient, series: dict[str, Any]) -> None:
    body = {"audience": "ADMIN", "data_label": "REAL", "series": series}
    assert client.post("/ai/insights", json=body, headers=AUTH).status_code == 422
