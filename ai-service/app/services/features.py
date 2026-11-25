"""Feature engineering shared by training (``training/train.py``) and inference.

There is exactly one implementation of every feature, so the model sees the
same features at serving time that it was trained on (no train/serve skew).

A forecast is made for one restaurant, one meal period and one target date,
from that restaurant's history for the same meal period. Only rows strictly
before a *cutoff* are used: at inference the cutoff is the last history row the
backend sent; in training the cutoff is ``target_date - horizon`` so the model
learns to forecast 1-31 days ahead exactly as it is used.

Quantity features are divided by a per-restaurant *scale* (the mean prepared
quantity over the last 28 observations). The model predicts surplus in units of
that scale, which keeps it independent of restaurant size and unit (meals,
packets, boxes). Predictions are multiplied back by the scale.
"""

from __future__ import annotations

import datetime as dt
import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

MIN_HISTORY_ROWS = 14
MAX_HORIZON_DAYS = 31
MEAL_PERIODS: tuple[str, ...] = ("BREAKFAST", "LUNCH", "DINNER", "ALL_DAY")

FEATURE_COLUMNS: tuple[str, ...] = (
    "last_surplus_norm",
    "roll7_mean_surplus_norm",
    "roll28_mean_surplus_norm",
    "roll7_std_surplus_norm",
    "same_weekday_mean4_norm",
    "surplus_ratio_28",
    "prepared_ref_norm",
    "planned_prepared_provided",
    "expected_surplus_norm",
    "horizon_days",
    "dow_0",
    "dow_1",
    "dow_2",
    "dow_3",
    "dow_4",
    "dow_5",
    "dow_6",
    "is_weekend",
    "month_sin",
    "month_cos",
    "is_holiday",
    "has_special_event",
    "meal_breakfast",
    "meal_lunch",
    "meal_dinner",
    "meal_all_day",
)

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class PeriodHistory:
    """Observed rows for one restaurant and one meal period, sorted by date."""

    ordinals: IntArray  # date.toordinal()
    weekdays: IntArray  # 0 = Monday
    prepared: FloatArray
    surplus: FloatArray

    @classmethod
    def from_rows(
        cls,
        dates: Sequence[dt.date],
        prepared: Sequence[float],
        surplus: Sequence[float],
    ) -> PeriodHistory:
        ordinals = np.array([d.toordinal() for d in dates], dtype=np.int64)
        order = np.argsort(ordinals, kind="stable")
        ordinals = ordinals[order]
        # date.weekday() == (ordinal - 1) % 7 for the proleptic Gregorian calendar.
        weekdays = ((ordinals - 1) % 7).astype(np.int64)
        return cls(
            ordinals=ordinals,
            weekdays=weekdays,
            prepared=np.asarray(prepared, dtype=np.float64)[order],
            surplus=np.asarray(surplus, dtype=np.float64)[order],
        )

    def __len__(self) -> int:
        return int(self.ordinals.shape[0])

    def rows_before(self, day: dt.date) -> int:
        """Number of rows strictly before ``day``."""
        return int(np.searchsorted(self.ordinals, day.toordinal(), side="left"))

    def rows_on_or_before(self, day: dt.date) -> int:
        """Number of rows on or before ``day``."""
        return int(np.searchsorted(self.ordinals, day.toordinal(), side="right"))


@dataclass(frozen=True, slots=True)
class FeatureRow:
    values: tuple[float, ...]  # ordered as FEATURE_COLUMNS
    scale: float
    baseline_qty: float  # same-weekday trailing mean (raw units): the baseline forecast
    horizon_days: int
    history_rows: int

    def as_dict(self) -> dict[str, float]:
        return dict(zip(FEATURE_COLUMNS, self.values, strict=True))


def _mean(values: FloatArray) -> float:
    return float(values.mean()) if values.size else 0.0


def compute_features(
    history: PeriodHistory,
    n_rows: int,
    *,
    target_date: dt.date,
    meal_period: str,
    is_holiday: bool,
    special_event: str | None,
    planned_prepared_qty: float | None,
) -> FeatureRow | None:
    """Features for ``target_date`` from the first ``n_rows`` history rows.

    Returns ``None`` when fewer than ``MIN_HISTORY_ROWS`` rows are available:
    the caller must then report insufficient history, never a guess.
    """
    if n_rows < MIN_HISTORY_ROWS:
        return None
    if meal_period not in MEAL_PERIODS:
        raise ValueError(f"unknown meal_period {meal_period!r}")

    surplus = history.surplus[:n_rows]
    prepared = history.prepared[:n_rows]
    weekdays = history.weekdays[:n_rows]
    last_ordinal = int(history.ordinals[n_rows - 1])
    target_ordinal = target_date.toordinal()
    if target_ordinal <= last_ordinal:
        raise ValueError("history used for features must end before the target date")

    last7_s, last28_s = surplus[-7:], surplus[-28:]
    last7_p, last28_p = prepared[-7:], prepared[-28:]

    scale = max(1.0, _mean(last28_p))
    roll28_mean = _mean(last28_s)

    target_weekday = target_date.weekday()
    same_weekday = surplus[weekdays == target_weekday][-4:]
    baseline_qty = _mean(same_weekday) if same_weekday.size else roll28_mean

    prepared_sum = float(last28_p.sum())
    surplus_ratio = float(last28_s.sum()) / prepared_sum if prepared_sum > 0 else 0.0

    planned_provided = planned_prepared_qty is not None
    prepared_ref = (
        float(planned_prepared_qty) if planned_prepared_qty is not None else _mean(last7_p)
    )
    prepared_ref_norm = prepared_ref / scale

    horizon = min(target_ordinal - last_ordinal, MAX_HORIZON_DAYS)
    month_angle = 2.0 * math.pi * (target_date.month - 1) / 12.0
    dow = [1.0 if target_weekday == i else 0.0 for i in range(7)]
    meal = [1.0 if meal_period == p else 0.0 for p in MEAL_PERIODS]

    values = (
        float(surplus[-1]) / scale,
        _mean(last7_s) / scale,
        roll28_mean / scale,
        float(last7_s.std()) / scale,
        baseline_qty / scale,
        surplus_ratio,
        prepared_ref_norm,
        1.0 if planned_provided else 0.0,
        prepared_ref_norm * surplus_ratio,
        float(horizon),
        *dow,
        1.0 if target_weekday >= 5 else 0.0,
        math.sin(month_angle),
        math.cos(month_angle),
        1.0 if is_holiday else 0.0,
        1.0 if special_event else 0.0,
        *meal,
    )
    return FeatureRow(
        values=values,
        scale=scale,
        baseline_qty=baseline_qty,
        horizon_days=horizon,
        history_rows=n_rows,
    )


def denormalize(predicted_norm: FloatArray, scale: FloatArray, planned: FloatArray) -> FloatArray:
    """Convert normalised predictions back to quantities.

    Surplus is never negative and never exceeds a planned prepared quantity
    (``planned`` is NaN where none was given).
    """
    quantity = np.maximum(0.0, predicted_norm * scale)
    return np.where(np.isnan(planned), quantity, np.minimum(quantity, planned))


def feature_matrix(rows: Sequence[FeatureRow]) -> FloatArray:
    """Stack feature rows into an (n, len(FEATURE_COLUMNS)) float matrix."""
    if not rows:
        return np.empty((0, len(FEATURE_COLUMNS)), dtype=np.float64)
    return np.asarray([row.values for row in rows], dtype=np.float64)
