from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security import require_service_token
from app.schemas.insights import InsightsRequest, InsightsResponse
from app.services.insights_service import compute_insights

router = APIRouter(prefix="/ai", tags=["analytics"], dependencies=[Depends(require_service_token)])


@router.post("/insights", response_model=InsightsResponse)
def insights_endpoint(body: InsightsRequest) -> InsightsResponse:
    """Sample-size-guarded insights computed from backend aggregates."""
    return compute_insights(body)
