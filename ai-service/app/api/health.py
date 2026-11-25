from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_forecaster, get_settings
from app.core.config import SERVICE_NAME, SERVICE_VERSION, Settings
from app.schemas.health import ForecasterInfo, HealthLLM, HealthModels, HealthResponse
from app.services.model_artifact import Forecaster

router = APIRouter(prefix="/ai", tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(
    settings: Annotated[Settings, Depends(get_settings)],
    forecaster: Annotated[Forecaster | None, Depends(get_forecaster)],
) -> HealthResponse:
    """Liveness. Always 200 while the process runs; reports what is loaded/configured."""
    info = None
    if forecaster is not None:
        info = ForecasterInfo(
            version=forecaster.version,
            algorithm=forecaster.algorithm,
            trained_at=forecaster.trained_at,
            training_data_label=forecaster.training_data_label,
            metrics=forecaster.summary_metrics(),
        )
    return HealthResponse(
        status="ok",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        models=HealthModels(surplus_forecaster=info),
        llm=HealthLLM(provider=settings.llm_provider, configured=settings.llm_configured),
    )
