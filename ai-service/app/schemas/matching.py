from __future__ import annotations

import datetime as dt
import math

from pydantic import Field, model_validator

from app.schemas.common import (
    ID_PATTERN,
    NAME_MAX,
    DietaryRequirement,
    DietaryType,
    DistanceSource,
    ResponseModel,
    StorageType,
    StrictModel,
    Unit,
    Urgency,
)

MAX_CANDIDATES = 500
MAX_DISTANCE_M = 1_000_000
MAX_QTY = 1_000_000
CATEGORY_PATTERN = r"^[A-Z0-9_]{1,50}$"

CRITERIA: tuple[str, ...] = (
    "distance",
    "food_requirement",
    "quantity_capacity",
    "food_preference",
    "urgency",
    "pickup_availability",
    "reliability",
    "beneficiary_demand",
)


class MatchWeights(StrictModel):
    """Configurable criterion weights. Non-negative and summing to 100."""

    distance: float = Field(default=20, ge=0, le=100)
    food_requirement: float = Field(default=20, ge=0, le=100)
    quantity_capacity: float = Field(default=15, ge=0, le=100)
    food_preference: float = Field(default=10, ge=0, le=100)
    urgency: float = Field(default=15, ge=0, le=100)
    pickup_availability: float = Field(default=10, ge=0, le=100)
    reliability: float = Field(default=5, ge=0, le=100)
    beneficiary_demand: float = Field(default=5, ge=0, le=100)

    @model_validator(mode="after")
    def _sum_to_100(self) -> MatchWeights:
        total = sum(getattr(self, name) for name in CRITERIA)
        if not math.isclose(total, 100.0, abs_tol=1e-6):
            raise ValueError(f"weights must sum to 100 (got {total:g})")
        return self

    def as_dict(self) -> dict[str, float]:
        return {name: float(getattr(self, name)) for name in CRITERIA}


class Reliability(StrictModel):
    completed: int = Field(ge=0, le=1_000_000)
    failed: int = Field(ge=0, le=1_000_000)


# --------------------------------------------------------------------------- NGO matching


class DonationSubject(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    category_code: str = Field(pattern=CATEGORY_PATTERN)
    dietary_type: DietaryType
    quantity_available: int = Field(ge=1, le=MAX_QTY)
    unit: Unit
    storage_type: StorageType
    requires_refrigeration: bool = False
    minutes_until_deadline: float = Field(ge=0, le=60 * 24 * 30)


class OpenNeed(StrictModel):
    quantity_remaining: int = Field(ge=0, le=MAX_QTY)
    urgency: Urgency
    dietary_requirement: DietaryRequirement


class NgoCandidate(StrictModel):
    ngo_id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=NAME_MAX)
    distance_m: float = Field(ge=0, le=MAX_DISTANCE_M)
    distance_source: DistanceSource
    travel_time_s: float | None = Field(default=None, ge=0, le=7 * 24 * 3600)
    collection_radius_m: float = Field(gt=0, le=MAX_DISTANCE_M)
    capacity_remaining: int | None = Field(default=None, ge=0, le=MAX_QTY)
    open_need: OpenNeed | None = None
    has_refrigeration: bool = False
    accepts_veg: bool = True
    accepts_non_veg: bool = True
    reliability: Reliability
    beneficiaries_count: int | None = Field(default=None, ge=0, le=10_000_000)


def _unique_ids(ids: list[str], label: str) -> None:
    seen: set[str] = set()
    for value in ids:
        if value in seen:
            raise ValueError(f"duplicate {label}: {value}")
        seen.add(value)


class MatchNgosRequest(StrictModel):
    donation: DonationSubject
    candidates: list[NgoCandidate] = Field(max_length=MAX_CANDIDATES)
    weights: MatchWeights = Field(default_factory=MatchWeights)

    @model_validator(mode="after")
    def _unique_candidates(self) -> MatchNgosRequest:
        _unique_ids([c.ngo_id for c in self.candidates], "ngo_id")
        return self


# --------------------------------------------------------------------------- donor matching


class AssistanceRequestSubject(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    category_code: str = Field(pattern=CATEGORY_PATTERN)
    dietary_requirement: DietaryRequirement
    quantity_remaining: int = Field(ge=1, le=MAX_QTY)
    unit: Unit
    urgency: Urgency
    beneficiaries_count: int = Field(ge=0, le=10_000_000)
    needed_from: dt.datetime | None = None
    needed_until: dt.datetime | None = None


class DonorCandidate(StrictModel):
    donor_id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=NAME_MAX)
    distance_m: float = Field(ge=0, le=MAX_DISTANCE_M)
    distance_source: DistanceSource
    travel_time_s: float | None = Field(default=None, ge=0, le=7 * 24 * 3600)
    max_radius_m: float = Field(gt=0, le=MAX_DISTANCE_M)
    available_matching_quantity: int = Field(default=0, ge=0, le=MAX_QTY)
    predicted_surplus: float | None = Field(default=None, ge=0, le=MAX_QTY)
    historical_avg_surplus: float | None = Field(default=None, ge=0, le=MAX_QTY)
    produces_category: bool = False
    availability_overlap_minutes: float | None = Field(default=None, ge=0, le=60 * 24 * 30)
    needed_window_minutes: float = Field(gt=0, le=60 * 24 * 30)
    reliability: Reliability


class MatchDonorsRequest(StrictModel):
    request: AssistanceRequestSubject
    candidates: list[DonorCandidate] = Field(max_length=MAX_CANDIDATES)
    weights: MatchWeights = Field(default_factory=MatchWeights)

    @model_validator(mode="after")
    def _unique_candidates(self) -> MatchDonorsRequest:
        _unique_ids([c.donor_id for c in self.candidates], "donor_id")
        return self


# --------------------------------------------------------------------------- response


class CriterionResult(ResponseModel):
    score: float
    weight: float
    contribution: float
    detail: str


class MatchResult(ResponseModel):
    candidate_id: str
    rank: int
    score: float
    criteria: dict[str, CriterionResult]
    explanation: str
    limitations: list[str]


class MatchResponse(ResponseModel):
    algorithm_version: str
    weights: dict[str, float]
    results: list[MatchResult]
