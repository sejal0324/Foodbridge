"""FoodBridge AI service: application factory.

Run with ``uvicorn app.main:app --port 8001``. ``app`` is created lazily on
first access so that importing this module (e.g. in tests) does not read the
environment; tests call ``create_app(settings)`` directly.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI
from pydantic import ValidationError

from app.api import allocation, analytics, assistant, health, matching, optimization, prediction
from app.core.config import SERVICE_NAME, SERVICE_VERSION, Settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.security import require_service_token
from app.services.model_artifact import ARTIFACT_DIR, load_forecaster

logger = logging.getLogger("app")


class ConfigurationError(RuntimeError):
    """Startup configuration is invalid. The message never contains values."""


def load_settings() -> Settings:
    try:
        return Settings()  # type: ignore[call-arg]  # values come from env/.env
    except ValidationError as exc:
        # Report field names and problems only: pydantic would echo input values,
        # which may be secrets.
        problems = ", ".join(
            f"{'.'.join(str(p) for p in err['loc']).upper()}: {err['type']}"
            for err in exc.errors(include_input=False, include_url=False)
        )
        raise ConfigurationError(f"Invalid AI service configuration ({problems})") from None


def create_app(settings: Settings | None = None, artifact_dir: Path | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            app.state.http_client = client
            logger.info(
                "startup",
                extra={
                    "service": SERVICE_NAME,
                    "version": SERVICE_VERSION,
                    "forecaster_loaded": app.state.forecaster is not None,
                    "llm_provider": settings.llm_provider,
                    "llm_configured": settings.llm_configured,
                },
            )
            yield

    app = FastAPI(
        title="FoodBridge AI service",
        version=SERVICE_VERSION,
        lifespan=lifespan,
        # Interactive docs are disabled; the schema is served behind auth below.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.forecaster = load_forecaster(artifact_dir or ARTIFACT_DIR)

    register_error_handlers(app)
    app.add_middleware(RequestContextMiddleware, max_body_bytes=settings.max_body_bytes)

    for module in (health, prediction, matching, allocation, optimization, assistant, analytics):
        app.include_router(module.router)

    @app.get(
        "/ai/openapi.json",
        include_in_schema=False,
        dependencies=[Depends(require_service_token)],
    )
    def openapi_schema() -> dict[str, Any]:
        return app.openapi()

    return app


_app: FastAPI | None = None


def __getattr__(name: str) -> FastAPI:
    """Lazily build the module-level ``app`` used by uvicorn."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
