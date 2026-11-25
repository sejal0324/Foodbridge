from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import ID_PATTERN, MealPeriod, ResponseModel, StrictModel, Unit

MAX_HISTORY_ROWS = 1500
MAX_TARGETS = 31
MAX_QTY = 1_000_000


class HistoryRow(StrictModel):
    date: dt.date
    meal_period: MealPeriod
    prepared_qty: int = Field(ge=0, le=MAX_QTY)
    sold_qty: int = Field(ge=0, le=MAX_QTY)
    surplus_qty: int = Field(ge=0, le=MAX_QTY)
    is_holiday: bool = False
    special_event: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _quantities_consistent(self) -> HistoryRow:
        if self.sold_qty > self.prepared_qty:
            raise ValueError("sold_qty cannot exceed prepared_qty")
        if self.surplus_qty > self.prepared_qty:
            raise ValueError("surplus_qty cannot exceed prepared_qty")
        return self


class TargetRow(StrictModel):
    date: dt.date
    meal_period: MealPeriod
    is_holiday: bool = False
    special_event: str | None = Field(default=None, max_length=100)
    planned_prepared_qty: int | None = Field(default=None, ge=0, le=MAX_QTY)


class PredictSurplusRequest(StrictModel):
    donor_id: str = Field(pattern=ID_PATTERN)
    unit: Unit = Unit.MEALS
    history: list[HistoryRow] = Field(max_length=MAX_HISTORY_ROWS)
    targets: list[TargetRow] = Field(min_length=1, max_length=MAX_TARGETS)

    @model_validator(mode="after")
    def _unique_keys(self) -> PredictSurplusRequest:
        seen: set[tuple[dt.date, str]] = set()
        for row in self.history:
            key = (row.date, row.meal_period.value)
            if key in seen:
                raise ValueError(
                    f"duplicate history row for {row.date.isoformat()} {row.meal_period.value}"
                )
            seen.add(key)
        targets: set[tuple[dt.date, str]] = set()
        for target in self.targets:
            key = (target.date, target.meal_period.value)
            if key in targets:
                raise ValueError(
                    f"duplicate target for {target.date.isoformat()} {target.meal_period.value}"
                )
            targets.add(key)
        return self


class ModelInfo(ResponseModel):
    name: Literal["surplus_forecaster"]
    version: str
    algorithm: str
    training_data_label: Literal["SYNTHETIC", "REAL", "MIXED"]


class Prediction(ResponseModel):
    date: dt.date
    meal_period: MealPeriod
    status: Literal["ok", "insufficient_history"]
    predicted_qty: int | None
    lower_qty: int | None
    upper_qty: int | None
    basis: Literal["model", "baseline"] | None


class PredictSurplusResponse(ResponseModel):
    model: ModelInfo
    predictions: list[Prediction]
    limitations: list[str]
    min_history_days: int
