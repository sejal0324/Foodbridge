"""Surplus forecasting at inference time.

Uses the shared feature module, so serving features are computed exactly as in
training. Targets with fewer than ``MIN_HISTORY_ROWS`` history rows for their
meal period get ``status="insufficient_history"`` and no number.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from app.core.errors import AppError
from app.schemas.prediction import (
    HistoryRow,
    ModelInfo,
    Prediction,
    PredictSurplusRequest,
    PredictSurplusResponse,
)
from app.services.features import (
    MAX_HORIZON_DAYS,
    MIN_HISTORY_ROWS,
    FeatureRow,
    PeriodHistory,
    compute_features,
    denormalize,
    feature_matrix,
)
from app.services.model_artifact import Forecaster

SYNTHETIC_LIMITATION = (
    "The forecasting model was trained on SYNTHETIC data, not real restaurant records; its "
    "accuracy on real donor history is unknown until it is retrained and evaluated on real data."
)
NOT_A_DONATION_LIMITATION = (
    "A forecast is an estimate of possible surplus, not a donation: no food exists, is reserved "
    "or is promised until the donor creates a donation."
)


def _histories(rows: list[HistoryRow]) -> dict[str, PeriodHistory]:
    grouped: dict[str, list[HistoryRow]] = defaultdict(list)
    for row in rows:
        grouped[row.meal_period.value].append(row)
    return {
        period: PeriodHistory.from_rows(
            [r.date for r in items], [r.prepared_qty for r in items], [r.surplus_qty for r in items]
        )
        for period, items in grouped.items()
    }


def _to_int(value: float) -> int:
    return max(0, math.floor(value + 0.5))


def predict_surplus(
    request: PredictSurplusRequest, forecaster: Forecaster | None
) -> PredictSurplusResponse:
    if forecaster is None:
        raise AppError(
            503,
            "MODEL_UNAVAILABLE",
            "The surplus forecasting model is not loaded; no forecast can be made.",
        )

    histories = _histories(request.history)
    empty = PeriodHistory.from_rows([], [], [])
    feature_rows: list[tuple[int, FeatureRow, float]] = []  # (target index, features, planned)
    stale_targets = 0
    for index, target in enumerate(request.targets):
        history = histories.get(target.meal_period.value, empty)
        n_rows = history.rows_before(target.date)
        feature_row = compute_features(
            history,
            n_rows,
            target_date=target.date,
            meal_period=target.meal_period.value,
            is_holiday=target.is_holiday,
            special_event=target.special_event,
            planned_prepared_qty=target.planned_prepared_qty,
        )
        if feature_row is None:
            continue
        if target.date.toordinal() - int(history.ordinals[n_rows - 1]) > MAX_HORIZON_DAYS:
            stale_targets += 1
        planned = (
            float(target.planned_prepared_qty)
            if target.planned_prepared_qty is not None
            else math.nan
        )
        feature_rows.append((index, feature_row, planned))

    results: dict[int, Prediction] = {}
    if feature_rows:
        rows = [fr for _, fr, _ in feature_rows]
        scale = np.array([fr.scale for fr in rows], dtype=np.float64)
        planned_caps = np.array([p for _, _, p in feature_rows], dtype=np.float64)
        if forecaster.estimator is not None:
            norm = np.asarray(forecaster.estimator.predict(feature_matrix(rows)), dtype=np.float64)
        else:
            norm = np.array([fr.baseline_qty for fr in rows], dtype=np.float64) / scale
        point = denormalize(norm, scale, planned_caps)
        lower = denormalize(point / scale + forecaster.interval.lower, scale, planned_caps)
        upper = denormalize(point / scale + forecaster.interval.upper, scale, planned_caps)
        for i, (index, _, _) in enumerate(feature_rows):
            target = request.targets[index]
            predicted = _to_int(point[i])
            results[index] = Prediction(
                date=target.date,
                meal_period=target.meal_period,
                status="ok",
                predicted_qty=predicted,
                lower_qty=min(_to_int(lower[i]), predicted),
                upper_qty=max(_to_int(upper[i]), predicted),
                basis="model" if forecaster.estimator is not None else "baseline",
            )

    predictions: list[Prediction] = []
    for index, target in enumerate(request.targets):
        predictions.append(
            results.get(index)
            or Prediction(
                date=target.date,
                meal_period=target.meal_period,
                status="insufficient_history",
                predicted_qty=None,
                lower_qty=None,
                upper_qty=None,
                basis=None,
            )
        )

    return PredictSurplusResponse(
        model=ModelInfo(
            name="surplus_forecaster",
            version=forecaster.version,
            algorithm=forecaster.algorithm,
            training_data_label=forecaster.training_data_label,
        ),
        predictions=predictions,
        limitations=_limitations(
            request, forecaster, len(predictions) - len(results), stale_targets
        ),
        min_history_days=MIN_HISTORY_ROWS,
    )


def _limitations(
    request: PredictSurplusRequest,
    forecaster: Forecaster,
    insufficient: int,
    stale_targets: int,
) -> list[str]:
    limitations: list[str] = []
    if forecaster.training_data_label != "REAL":
        limitations.append(SYNTHETIC_LIMITATION)
    limitations.append(NOT_A_DONATION_LIMITATION)
    low = round(forecaster.interval.lower_quantile * 100)
    high = round(forecaster.interval.upper_quantile * 100)
    limitations.append(
        f"lower_qty/upper_qty span the {low}th-{high}th percentile of validation errors "
        "(an approximate range, not a guarantee)."
    )
    if forecaster.estimator is None:
        limitations.append(
            "The trained models did not beat the historical-average baseline, so forecasts use "
            "the same-weekday trailing mean of surplus."
        )
    if insufficient:
        limitations.append(
            f"{insufficient} target(s) have fewer than {MIN_HISTORY_ROWS} history rows for their "
            "meal period before the target date; no forecast is given for them."
        )
    if stale_targets:
        limitations.append(
            f"For {stale_targets} target(s) the most recent history is more than "
            f"{MAX_HORIZON_DAYS} days before the target date; those forecasts are less reliable."
        )
    if any(t.special_event for t in request.targets):
        limitations.append(
            "Special events are used only as a yes/no flag; their size and type are not modelled."
        )
    if request.unit.value != "MEALS":
        limitations.append(
            f"The model was trained on meal counts; forecasts in {request.unit.value} rely on "
            "this donor's own history being on a consistent scale."
        )
    return limitations
