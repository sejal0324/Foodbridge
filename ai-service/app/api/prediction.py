from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_forecaster
from app.core.security import require_service_token
from app.schemas.prediction import PredictSurplusRequest, PredictSurplusResponse
from app.services.model_artifact import Forecaster
from app.services.prediction_service import predict_surplus

router = APIRouter(prefix="/ai", tags=["prediction"], dependencies=[Depends(require_service_token)])


@router.post("/predict-surplus", response_model=PredictSurplusResponse)
def predict_surplus_endpoint(
    body: PredictSurplusRequest,
    forecaster: Annotated[Forecaster | None, Depends(get_forecaster)],
) -> PredictSurplusResponse:
    """Forecast surplus per target date and meal period (never a donation)."""
    return predict_surplus(body, forecaster)
