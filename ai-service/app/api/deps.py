"""Request-scoped dependencies resolved from application state."""

from __future__ import annotations

from fastapi import Request

from app.core.config import Settings
from app.services.llm_providers import LLMProvider
from app.services.llm_service import build_provider
from app.services.model_artifact import Forecaster


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_forecaster(request: Request) -> Forecaster | None:
    forecaster: Forecaster | None = request.app.state.forecaster
    return forecaster


def get_llm_provider(request: Request) -> LLMProvider | None:
    return build_provider(request.app.state.settings, request.app.state.http_client)
