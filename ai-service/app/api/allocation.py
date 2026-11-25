from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security import require_service_token
from app.schemas.allocation import AllocateFoodRequest, AllocateFoodResponse
from app.services.allocation_service import allocate_food

router = APIRouter(prefix="/ai", tags=["allocation"], dependencies=[Depends(require_service_token)])


@router.post("/allocate-food", response_model=AllocateFoodResponse)
def allocate_food_endpoint(body: AllocateFoodRequest) -> AllocateFoodResponse:
    """Recommend integer allocations (CP-SAT). The backend validates and executes."""
    return allocate_food(body)
