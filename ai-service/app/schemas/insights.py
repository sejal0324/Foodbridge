from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, model_validator

from app.schemas.common import DietaryRequirement, ResponseModel, StrictModel

MAX_SERIES = 5000
CATEGORY_PATTERN = r"^[A-Z0-9_]{1,50}$"


class WeekdayPoint(StrictModel):
    weekday: int = Field(ge=1, le=7)  # ISO: 1 = Monday ... 7 = Sunday
    count: int = Field(ge=0, le=10_000_000)
    quantity: float = Field(ge=0, le=1e9)


class UnmetCategoryPoint(StrictModel):
    category_code: str = Field(pattern=CATEGORY_PATTERN)
    dietary_requirement: DietaryRequirement
    open_requests: int = Field(ge=0, le=10_000_000)
    quantity_remaining: float = Field(ge=0, le=1e9)


class CollectionPoint(StrictModel):
    distance_m: float = Field(ge=0, le=5_000_000)
    delay_minutes: float = Field(ge=-1440, le=10_080)


class MonthPoint(StrictModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    quantity: float = Field(ge=0, le=1e9)
    # Optional number of completed collections in the month (the trend's sample size).
    count: int | None = Field(default=None, ge=0, le=10_000_000)


class InsightSeries(StrictModel):
    donations_by_weekday: list[WeekdayPoint] | None = Field(default=None, max_length=MAX_SERIES)
    unmet_requests_by_category: list[UnmetCategoryPoint] | None = Field(
        default=None, max_length=MAX_SERIES
    )
    collections: list[CollectionPoint] | None = Field(default=None, max_length=MAX_SERIES)
    monthly_completed: list[MonthPoint] | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def _unique_months(self) -> InsightSeries:
        months = [m.month for m in self.monthly_completed or []]
        if len(set(months)) != len(months):
            raise ValueError("monthly_completed months must be unique")
        return self


class InsightsRequest(StrictModel):
    audience: Literal["ADMIN", "DONOR", "NGO"]
    data_label: Literal["REAL", "SYNTHETIC", "MIXED"]
    min_sample_size: int = Field(default=20, ge=1, le=1_000_000)
    series: InsightSeries = Field(default_factory=InsightSeries)


InsightType = Literal["WEEKEND_VS_WEEKDAY", "UNMET_DEMAND", "DISTANCE_DELAY", "TREND"]
Confidence = Literal["LOW", "MEDIUM", "HIGH"]


class Insight(ResponseModel):
    type: InsightType
    title: str
    body: str
    sample_size: int
    confidence: Confidence
    supporting_data: dict[str, Any]
    limitations: list[str]


class SkippedInsight(ResponseModel):
    type: InsightType
    reason: str


class InsightsResponse(ResponseModel):
    insights: list[Insight]
    skipped: list[SkippedInsight]
