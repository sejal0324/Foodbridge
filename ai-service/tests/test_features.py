"""Shared feature engineering (used by training and inference)."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pytest

from app.services.features import (
    FEATURE_COLUMNS,
    MAX_HORIZON_DAYS,
    MIN_HISTORY_ROWS,
    PeriodHistory,
    compute_features,
    denormalize,
)

START = dt.date(2026, 9, 7)  # a Monday


def make_history(days: int) -> PeriodHistory:
    dates = [START + dt.timedelta(days=i) for i in range(days)]
    prepared = [100.0 + i for i in range(days)]
    surplus = [float(10 + (i % 7)) for i in range(days)]  # weekday-dependent pattern
    return PeriodHistory.from_rows(dates, prepared, surplus)


def features(history: PeriodHistory, n_rows: int, target: dt.date, **kwargs: object) -> dict:
    row = compute_features(
        history,
        n_rows,
        target_date=target,
        meal_period=str(kwargs.get("meal_period", "LUNCH")),
        is_holiday=bool(kwargs.get("is_holiday", False)),
        special_event=kwargs.get("special_event"),  # type: ignore[arg-type]
        planned_prepared_qty=kwargs.get("planned"),  # type: ignore[arg-type]
    )
    assert row is not None
    return {"values": row.as_dict(), "row": row}


def test_requires_min_history_rows() -> None:
    history = make_history(20)
    target = START + dt.timedelta(days=30)
    assert (
        compute_features(
            history,
            MIN_HISTORY_ROWS - 1,
            target_date=target,
            meal_period="LUNCH",
            is_holiday=False,
            special_event=None,
            planned_prepared_qty=None,
        )
        is None
    )
    assert (
        compute_features(
            history,
            MIN_HISTORY_ROWS,
            target_date=target,
            meal_period="LUNCH",
            is_holiday=False,
            special_event=None,
            planned_prepared_qty=None,
        )
        is not None
    )


def test_hand_computed_features() -> None:
    history = make_history(28)  # 4 full weeks, Mon..Sun
    target = START + dt.timedelta(days=28)  # Monday, horizon 1
    result = features(history, 28, target, planned=None)
    values, row = result["values"], result["row"]
    scale = np.mean([100.0 + i for i in range(28)])  # mean prepared over last 28
    assert row.scale == pytest.approx(scale)
    # Mondays have surplus 10 every week -> same-weekday trailing mean is 10.
    assert row.baseline_qty == pytest.approx(10.0)
    assert values["same_weekday_mean4_norm"] == pytest.approx(10.0 / scale)
    assert values["last_surplus_norm"] == pytest.approx(16.0 / scale)  # last row is a Sunday
    assert values["roll7_mean_surplus_norm"] == pytest.approx(13.0 / scale)
    assert values["horizon_days"] == 1
    assert values["dow_0"] == 1.0 and values["is_weekend"] == 0.0
    assert values["planned_prepared_provided"] == 0.0
    ratio = sum(10 + (i % 7) for i in range(28)) / sum(100.0 + i for i in range(28))
    assert values["surplus_ratio_28"] == pytest.approx(ratio)
    assert len(row.values) == len(FEATURE_COLUMNS)


def test_only_rows_before_cutoff_are_used() -> None:
    history = make_history(60)
    target = START + dt.timedelta(days=45)
    cutoff_rows = history.rows_before(START + dt.timedelta(days=40))
    a = features(history, cutoff_rows, target)["values"]
    # Changing rows after the cutoff must not change the features.
    altered = PeriodHistory.from_rows(
        [START + dt.timedelta(days=i) for i in range(60)],
        [100.0 + i for i in range(60)],
        [float(10 + (i % 7)) if i < 40 else 999.0 for i in range(60)],
    )
    b = features(altered, cutoff_rows, target)["values"]
    assert a == b
    assert a["horizon_days"] == 6


def test_horizon_is_clipped() -> None:
    history = make_history(20)
    far = START + dt.timedelta(days=200)
    assert features(history, 20, far)["values"]["horizon_days"] == MAX_HORIZON_DAYS


def test_planned_quantity_and_flags() -> None:
    history = make_history(20)
    target = START + dt.timedelta(days=26)  # Saturday
    values = features(
        history,
        20,
        target,
        planned=250.0,
        is_holiday=True,
        special_event="CATERING_ORDER",
        meal_period="DINNER",
    )["values"]
    assert values["planned_prepared_provided"] == 1.0
    assert values["is_holiday"] == 1.0
    assert values["has_special_event"] == 1.0
    assert values["is_weekend"] == 1.0
    assert values["meal_dinner"] == 1.0 and values["meal_lunch"] == 0.0


def test_target_must_be_after_history() -> None:
    history = make_history(20)
    with pytest.raises(ValueError, match="before the target"):
        compute_features(
            history,
            20,
            target_date=START + dt.timedelta(days=5),
            meal_period="LUNCH",
            is_holiday=False,
            special_event=None,
            planned_prepared_qty=None,
        )


def test_denormalize_clips_to_zero_and_planned() -> None:
    out = denormalize(
        np.array([-0.5, 0.2, 0.9]),
        np.array([100.0, 100.0, 100.0]),
        np.array([np.nan, np.nan, 50.0]),
    )
    assert out.tolist() == [0.0, 20.0, 50.0]
