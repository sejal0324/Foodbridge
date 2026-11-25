from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security import require_service_token
from app.schemas.route import OptimizeRouteRequest, OptimizeRouteResponse
from app.services.route_service import optimize_route

router = APIRouter(
    prefix="/ai", tags=["optimization"], dependencies=[Depends(require_service_token)]
)


@router.post("/optimize-route", response_model=OptimizeRouteResponse)
def optimize_route_endpoint(body: OptimizeRouteRequest) -> OptimizeRouteResponse:
    """Single-vehicle pickup route with time windows and capacity (VRPTW)."""
    return optimize_route(body)
