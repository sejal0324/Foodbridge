from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import ID_PATTERN, DistanceSource, ResponseModel, StrictModel

MAX_LOCATIONS = 60
MAX_SECONDS = 7 * 24 * 3600
MAX_METRES = 5_000_000
MAX_DEMAND = 100_000


class Location(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    type: Literal["START", "PICKUP", "END"]
    demand: int = Field(default=0, ge=0, le=MAX_DEMAND)
    window_start_s: int | None = Field(default=None, ge=0, le=MAX_SECONDS)
    window_end_s: int | None = Field(default=None, ge=0, le=MAX_SECONDS)
    service_time_s: int = Field(default=0, ge=0, le=MAX_SECONDS)

    @model_validator(mode="after")
    def _window_order(self) -> Location:
        if (
            self.window_start_s is not None
            and self.window_end_s is not None
            and self.window_start_s > self.window_end_s
        ):
            raise ValueError(f"location {self.id}: window_start_s is after window_end_s")
        return self


class OptimizeRouteRequest(StrictModel):
    locations: list[Location] = Field(min_length=1, max_length=MAX_LOCATIONS)
    start_index: int = Field(ge=0)
    end_index: int = Field(ge=0)
    vehicle_capacity: int = Field(ge=0, le=MAX_DEMAND * MAX_LOCATIONS)
    duration_matrix_s: list[list[int]]
    distance_matrix_m: list[list[int]]
    distance_source: DistanceSource
    time_limit_s: float = Field(default=5.0, gt=0, le=10)

    @model_validator(mode="after")
    def _consistent(self) -> OptimizeRouteRequest:
        n = len(self.locations)
        ids = [loc.id for loc in self.locations]
        if len(set(ids)) != n:
            raise ValueError("location ids must be unique")
        if self.start_index >= n or self.end_index >= n:
            raise ValueError(f"start_index and end_index must be < {n}")
        start, end = self.locations[self.start_index], self.locations[self.end_index]
        if start.type != "START":
            raise ValueError("the location at start_index must have type START")
        if self.end_index != self.start_index and end.type != "END":
            raise ValueError("the location at end_index must have type END")
        for i, loc in enumerate(self.locations):
            if i not in (self.start_index, self.end_index) and loc.type != "PICKUP":
                raise ValueError(f"location {loc.id} must be a PICKUP (only one START and END)")
        for name, matrix, limit in (
            ("duration_matrix_s", self.duration_matrix_s, MAX_SECONDS),
            ("distance_matrix_m", self.distance_matrix_m, MAX_METRES),
        ):
            if len(matrix) != n or any(len(row) != n for row in matrix):
                raise ValueError(f"{name} must be {n}x{n} to match locations")
            if any(value < 0 or value > limit for row in matrix for value in row):
                raise ValueError(f"{name} values must be between 0 and {limit}")
        return self


RouteStatus = Literal["OPTIMAL", "FEASIBLE", "PARTIAL", "INFEASIBLE", "TIMEOUT"]


class RouteStop(ResponseModel):
    location_id: str
    sequence: int
    arrival_s: int
    departure_s: int
    load_after: int


class DroppedStop(ResponseModel):
    location_id: str
    reason: str


class OptimizeRouteResponse(ResponseModel):
    status: RouteStatus
    route: list[RouteStop]
    dropped: list[DroppedStop]
    total_distance_m: int
    total_duration_s: int
    distance_source: DistanceSource
    explanation: str
    reasons: list[str]
