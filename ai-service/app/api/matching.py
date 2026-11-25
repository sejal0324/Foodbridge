from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security import require_service_token
from app.schemas.matching import MatchDonorsRequest, MatchNgosRequest, MatchResponse
from app.services.matching_service import match_donors, match_ngos

router = APIRouter(prefix="/ai", tags=["matching"], dependencies=[Depends(require_service_token)])


@router.post("/match-ngos", response_model=MatchResponse)
def match_ngos_endpoint(body: MatchNgosRequest) -> MatchResponse:
    """Rank eligible NGO candidates for a donation (deterministic weighted score)."""
    return match_ngos(body)


@router.post("/match-donors", response_model=MatchResponse)
def match_donors_endpoint(body: MatchDonorsRequest) -> MatchResponse:
    """Rank eligible donor candidates for an NGO assistance request."""
    return match_donors(body)
