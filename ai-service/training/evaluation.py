"""Metrics and residual analysis for the surplus forecaster."""

from __future__ import annotations

from typing import Any

import numpy as np
import numpy.typing as npt
import pandas as pd

FloatArray = npt.NDArray[np.float64]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def mae(actual: FloatArray, predicted: FloatArray) -> float:
    return float(np.mean(np.abs(actual - predicted)))


def rmse(actual: FloatArray, predicted: FloatArray) -> float:
    return float(np.sqrt(np.mean((actual - predicted) ** 2)))


def metrics(actual: FloatArray, predicted: FloatArray) -> dict[str, float]:
    return {"mae": round(mae(actual, predicted), 4), "rmse": round(rmse(actual, predicted), 4)}


def _group_stats(frame: pd.DataFrame, key: str) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for value, group in frame.groupby(key, sort=True):
        residual = group["actual"] - group["predicted"]
        out[str(value)] = {
            "n": len(group),
            "mae": round(float(residual.abs().mean()), 3),
            "bias_actual_minus_predicted": round(float(residual.mean()), 3),
            "mean_actual": round(float(group["actual"].mean()), 3),
        }
    return out


def residual_analysis(frame: pd.DataFrame) -> dict[str, Any]:
    """Residuals (actual - predicted) of the selected model on the test split.

    ``frame`` needs columns: actual, predicted, weekday, restaurant_size,
    meal_period, horizon_days, is_holiday, has_event, lower, upper.
    """
    data = frame.copy()
    data["weekday_name"] = [f"{d}-{WEEKDAYS[d]}" for d in data["weekday"].astype(int)]
    data["horizon_bucket"] = pd.cut(
        data["horizon_days"], bins=[0, 7, 14, 31], labels=["1-7", "8-14", "15-31"]
    ).astype(str)
    data["holiday"] = np.where(data["is_holiday"], "holiday", "non_holiday")
    data["event"] = np.where(data["has_event"], "special_event", "no_event")
    residual = data["actual"] - data["predicted"]
    within = (data["actual"] >= data["lower"]) & (data["actual"] <= data["upper"])
    return {
        "n": len(data),
        "bias_actual_minus_predicted": round(float(residual.mean()), 3),
        "residual_quantiles": {
            q: round(float(residual.quantile(float(q))), 3) for q in ("0.1", "0.5", "0.9")
        },
        "interval_coverage": round(float(within.mean()), 4),
        "by_weekday": _group_stats(data, "weekday_name"),
        "by_restaurant_size": _group_stats(data, "restaurant_size"),
        "by_meal_period": _group_stats(data, "meal_period"),
        "by_horizon_days": _group_stats(data, "horizon_bucket"),
        "by_holiday": _group_stats(data, "holiday"),
        "by_special_event": _group_stats(data, "event"),
    }
