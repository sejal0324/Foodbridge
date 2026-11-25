"""POST /ai/predict-surplus."""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import AUTH

LAST_HISTORY_DAY = dt.date(2026, 11, 3)


def history(days: int, meal_period: str = "LUNCH", base: int = 200) -> list[dict[str, Any]]:
    """Deterministic, plausible history ending on LAST_HISTORY_DAY."""
    rows = []
    for i in range(days):
        day = LAST_HISTORY_DAY - dt.timedelta(days=days - 1 - i)
        prepared = base + (20 if day.weekday() >= 5 else 0) + (i % 5) * 3
        surplus = 15 + (i * 7) % 13 + (10 if day.weekday() == 4 else 0)
        rows.append(
            {
                "date": day.isoformat(),
                "meal_period": meal_period,
                "prepared_qty": prepared,
                "sold_qty": prepared - surplus,
                "surplus_qty": surplus,
                "is_holiday": False,
                "special_event": None,
            }
        )
    return rows


def request_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "donor_id": "9b2f6c1e-1d2a-4c5b-8e7f-0a1b2c3d4e5f",
        "unit": "MEALS",
        "history": history(60) + history(10, "DINNER"),
        "targets": [
            {
                "date": "2026-11-04",
                "meal_period": "LUNCH",
                "is_holiday": False,
                "special_event": None,
                "planned_prepared_qty": None,
            },
            {
                "date": "2026-11-08",
                "meal_period": "LUNCH",
                "is_holiday": True,
                "special_event": "LOCAL_FESTIVAL",
                "planned_prepared_qty": None,
            },
            {"date": "2026-11-04", "meal_period": "DINNER"},
            {"date": "2026-11-04", "meal_period": "BREAKFAST"},
        ],
    }
    body.update(overrides)
    return body


def test_predictions_are_non_negative_integers_with_ordered_interval(client: TestClient) -> None:
    response = client.post("/ai/predict-surplus", json=request_body(), headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["min_history_days"] == 14
    assert body["model"]["name"] == "surplus_forecaster"
    assert body["model"]["training_data_label"] == "SYNTHETIC"
    ok = [p for p in body["predictions"] if p["status"] == "ok"]
    assert len(ok) == 2
    for prediction in ok:
        for key in ("predicted_qty", "lower_qty", "upper_qty"):
            assert isinstance(prediction[key], int)
            assert prediction[key] >= 0
        assert prediction["lower_qty"] <= prediction["predicted_qty"] <= prediction["upper_qty"]
        assert prediction["basis"] == "model"
    # Order and identity of targets are preserved.
    assert [(p["date"], p["meal_period"]) for p in body["predictions"]] == [
        ("2026-11-04", "LUNCH"),
        ("2026-11-08", "LUNCH"),
        ("2026-11-04", "DINNER"),
        ("2026-11-04", "BREAKFAST"),
    ]


def test_insufficient_history_returns_nulls_not_guesses(client: TestClient) -> None:
    body = client.post("/ai/predict-surplus", json=request_body(), headers=AUTH).json()
    dinner, breakfast = body["predictions"][2], body["predictions"][3]
    for prediction in (dinner, breakfast):
        assert prediction["status"] == "insufficient_history"
        assert prediction["predicted_qty"] is None
        assert prediction["lower_qty"] is None
        assert prediction["upper_qty"] is None
        assert prediction["basis"] is None
    assert any("fewer than 14 history rows" in text for text in body["limitations"])


def test_exactly_14_rows_is_enough(client: TestClient) -> None:
    body = request_body(
        history=history(14), targets=[{"date": "2026-11-04", "meal_period": "LUNCH"}]
    )
    response = client.post("/ai/predict-surplus", json=body, headers=AUTH).json()
    assert response["predictions"][0]["status"] == "ok"
    body["history"] = history(13)
    response = client.post("/ai/predict-surplus", json=body, headers=AUTH).json()
    assert response["predictions"][0]["status"] == "insufficient_history"


def test_limitations_state_synthetic_training_and_not_a_donation(client: TestClient) -> None:
    limitations = client.post("/ai/predict-surplus", json=request_body(), headers=AUTH).json()[
        "limitations"
    ]
    text = " ".join(limitations)
    assert "SYNTHETIC" in text
    assert "not a donation" in text


def test_predictions_are_deterministic(client: TestClient) -> None:
    first = client.post("/ai/predict-surplus", json=request_body(), headers=AUTH).json()
    second = client.post("/ai/predict-surplus", json=request_body(), headers=AUTH).json()
    assert first == second


def test_history_order_does_not_matter(client: TestClient) -> None:
    forward = request_body()
    backward = request_body(history=list(reversed(forward["history"])))
    first = client.post("/ai/predict-surplus", json=forward, headers=AUTH).json()
    second = client.post("/ai/predict-surplus", json=backward, headers=AUTH).json()
    assert first["predictions"] == second["predictions"]


def test_planned_prepared_qty_caps_the_forecast(client: TestClient) -> None:
    targets = [{"date": "2026-11-04", "meal_period": "LUNCH", "planned_prepared_qty": 5}]
    body = client.post(
        "/ai/predict-surplus", json=request_body(targets=targets), headers=AUTH
    ).json()
    prediction = body["predictions"][0]
    assert prediction["upper_qty"] <= 5
    assert prediction["predicted_qty"] <= 5


def test_history_on_or_after_target_is_ignored(client: TestClient) -> None:
    base = request_body(targets=[{"date": "2026-11-04", "meal_period": "LUNCH"}])
    with_future = request_body(
        targets=[{"date": "2026-11-04", "meal_period": "LUNCH"}],
        history=base["history"]
        + [
            {
                "date": "2026-11-04",
                "meal_period": "LUNCH",
                "prepared_qty": 900,
                "sold_qty": 0,
                "surplus_qty": 900,
            },
            {
                "date": "2026-11-05",
                "meal_period": "LUNCH",
                "prepared_qty": 900,
                "sold_qty": 0,
                "surplus_qty": 900,
            },
        ],
    )
    first = client.post("/ai/predict-surplus", json=base, headers=AUTH).json()
    second = client.post("/ai/predict-surplus", json=with_future, headers=AUTH).json()
    assert first["predictions"] == second["predictions"]


def test_stale_history_adds_limitation(client: TestClient) -> None:
    targets = [{"date": "2026-12-20", "meal_period": "LUNCH"}]
    body = client.post(
        "/ai/predict-surplus", json=request_body(targets=targets), headers=AUTH
    ).json()
    assert body["predictions"][0]["status"] == "ok"
    assert any("more than 31 days" in text for text in body["limitations"])


def test_forecast_scales_with_restaurant_size(client: TestClient) -> None:
    targets = [{"date": "2026-11-04", "meal_period": "LUNCH"}]
    small = request_body(history=history(60, base=200), targets=targets)
    large = request_body(
        history=[
            {
                **row,
                "prepared_qty": row["prepared_qty"] * 10,
                "sold_qty": row["sold_qty"] * 10,
                "surplus_qty": row["surplus_qty"] * 10,
            }
            for row in history(60, base=200)
        ],
        targets=targets,
    )
    p_small = client.post("/ai/predict-surplus", json=small, headers=AUTH).json()["predictions"][0]
    p_large = client.post("/ai/predict-surplus", json=large, headers=AUTH).json()["predictions"][0]
    assert math.isclose(p_large["predicted_qty"], p_small["predicted_qty"] * 10, rel_tol=0.05)


def test_validation_errors(client: TestClient) -> None:
    rows = history(20)
    duplicate = request_body(history=[*rows, rows[0]])
    assert client.post("/ai/predict-surplus", json=duplicate, headers=AUTH).status_code == 422

    bad_row = dict(rows[0], sold_qty=rows[0]["prepared_qty"] + 1)
    inconsistent = request_body(history=[bad_row])
    assert client.post("/ai/predict-surplus", json=inconsistent, headers=AUTH).status_code == 422

    negative = request_body(history=[dict(rows[0], surplus_qty=-1)])
    assert client.post("/ai/predict-surplus", json=negative, headers=AUTH).status_code == 422

    fractional = request_body(history=[dict(rows[0], surplus_qty=2.5)])
    assert client.post("/ai/predict-surplus", json=fractional, headers=AUTH).status_code == 422

    too_many = request_body(
        targets=[{"date": f"2026-12-{d:02d}", "meal_period": "LUNCH"} for d in range(1, 32)]
        + [{"date": "2027-01-01", "meal_period": "LUNCH"}]
    )
    assert client.post("/ai/predict-surplus", json=too_many, headers=AUTH).status_code == 422

    bad_enum = request_body(unit="KG")
    assert client.post("/ai/predict-surplus", json=bad_enum, headers=AUTH).status_code == 422

    no_targets = request_body(targets=[])
    assert client.post("/ai/predict-surplus", json=no_targets, headers=AUTH).status_code == 422

    too_long = request_body(history=history(1501))
    assert client.post("/ai/predict-surplus", json=too_long, headers=AUTH).status_code == 422
