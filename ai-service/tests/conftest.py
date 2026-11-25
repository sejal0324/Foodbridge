"""Shared fixtures. Tests never read the repository's .env files."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

TOKEN = "test-service-token-" + "x" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ENV_VARS = (
    "INTERNAL_SERVICE_TOKEN",
    "LLM_PROVIDER",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "LOG_LEVEL",
    "AI_SERVICE_PORT",
)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove service variables inherited from the developer's shell."""
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "internal_service_token": TOKEN,
        "llm_provider": "none",
        "openai_api_key": None,
        "gemini_api_key": None,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def app_factory() -> Iterator[Callable[..., TestClient]]:
    """Build a started TestClient for an app with custom settings."""
    clients: list[TestClient] = []

    def factory(app: FastAPI | None = None, **overrides: Any) -> TestClient:
        client = TestClient(app or create_app(make_settings(**overrides)))
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(app_factory: Callable[..., TestClient]) -> TestClient:
    return app_factory()
