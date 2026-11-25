from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import ID_PATTERN, ResponseModel, StrictModel

MAX_NODES = 500
MAX_EDGES = 5000
MAX_QTY = 1_000_000


class Supply(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    quantity: int = Field(ge=0, le=MAX_QTY)


class Demand(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    quantity: int = Field(ge=0, le=MAX_QTY)
    min_quantity: int = Field(default=1, ge=1, le=MAX_QTY)


class Edge(StrictModel):
    supply_id: str = Field(pattern=ID_PATTERN)
    demand_id: str = Field(pattern=ID_PATTERN)
    score: float = Field(ge=0, le=100)
    max_quantity: int | None = Field(default=None, ge=0, le=MAX_QTY)


class AllocateFoodRequest(StrictModel):
    supplies: list[Supply] = Field(min_length=1, max_length=MAX_NODES)
    demands: list[Demand] = Field(min_length=1, max_length=MAX_NODES)
    edges: list[Edge] = Field(max_length=MAX_EDGES)
    time_limit_s: float = Field(default=5.0, gt=0, le=10)

    @model_validator(mode="after")
    def _consistent_ids(self) -> AllocateFoodRequest:
        supply_ids = [s.id for s in self.supplies]
        demand_ids = [d.id for d in self.demands]
        if len(set(supply_ids)) != len(supply_ids):
            raise ValueError("supply ids must be unique")
        if len(set(demand_ids)) != len(demand_ids):
            raise ValueError("demand ids must be unique")
        known_supplies, known_demands = set(supply_ids), set(demand_ids)
        pairs: set[tuple[str, str]] = set()
        for edge in self.edges:
            if edge.supply_id not in known_supplies:
                raise ValueError(f"edge references unknown supply_id {edge.supply_id}")
            if edge.demand_id not in known_demands:
                raise ValueError(f"edge references unknown demand_id {edge.demand_id}")
            pair = (edge.supply_id, edge.demand_id)
            if pair in pairs:
                raise ValueError(f"duplicate edge {edge.supply_id} -> {edge.demand_id}")
            pairs.add(pair)
        return self


AllocationStatus = Literal["OPTIMAL", "FEASIBLE", "NO_FEASIBLE_ALLOCATION", "TIMEOUT"]


class Allocation(ResponseModel):
    supply_id: str
    demand_id: str
    quantity: int


class Remaining(ResponseModel):
    id: str
    quantity: int


class AllocateFoodResponse(ResponseModel):
    status: AllocationStatus
    allocations: list[Allocation]
    total_allocated: int
    unallocated_supply: list[Remaining]
    unmet_demand: list[Remaining]
    explanation: str
    reasons: list[str]
