from __future__ import annotations

from typing import Any, Literal

from app.schemas.common import ResponseModel


class ForecasterInfo(ResponseModel):
    version: str
    algorithm: str
    trained_at: str
    training_data_label: Literal["SYNTHETIC", "REAL", "MIXED"]
    metrics: dict[str, Any]


class HealthModels(ResponseModel):
    surplus_forecaster: ForecasterInfo | None


class HealthLLM(ResponseModel):
    provider: Literal["none", "gemini", "openai"]
    configured: bool


class HealthResponse(ResponseModel):
    status: Literal["ok"]
    service: str
    version: str
    models: HealthModels
    llm: HealthLLM
