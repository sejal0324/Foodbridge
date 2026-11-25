"""Cross-cutting behaviour: auth, error envelope, request ids, body limit, config, health."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.logging import JsonFormatter
from app.main import ConfigurationError, create_app, load_settings
from tests.conftest import AUTH, TOKEN, make_settings

PROTECTED = [
    "/ai/predict-surplus",
    "/ai/match-ngos",
    "/ai/match-donors",
    "/ai/allocate-food",
    "/ai/optimize-route",
    "/ai/assistant",
    "/ai/insights",
]


def assert_envelope(response_json: dict, code: str) -> dict:
    assert set(response_json) == {"error"}
    error = response_json["error"]
    assert error["code"] == code
    assert isinstance(error["message"], str) and error["message"]
    assert isinstance(error["request_id"], str) and error["request_id"]
    return error


# --------------------------------------------------------------------------- health


def test_health_requires_no_auth_and_reports_model(client: TestClient) -> None:
    response = client.get("/ai/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "foodbridge-ai"
    assert body["version"] == "1.0.0"
    forecaster = body["models"]["surplus_forecaster"]
    assert forecaster["training_data_label"] == "SYNTHETIC"
    assert forecaster["version"].startswith("sf-")
    assert forecaster["metrics"]["mae"] <= forecaster["metrics"]["baseline_mae"]
    assert body["llm"] == {"provider": "none", "configured": False}


def test_health_reports_configured_llm(app_factory: Callable[..., TestClient]) -> None:
    client = app_factory(llm_provider="openai", openai_api_key="sk-test")
    assert client.get("/ai/health").json()["llm"] == {"provider": "openai", "configured": True}


def test_missing_model_artifact_keeps_liveness_and_returns_503(
    app_factory: Callable[..., TestClient], tmp_path: Path
) -> None:
    client = app_factory(app=create_app(make_settings(), artifact_dir=tmp_path))
    health = client.get("/ai/health")
    assert health.status_code == 200
    assert health.json()["models"]["surplus_forecaster"] is None
    body = {
        "donor_id": "d1",
        "unit": "MEALS",
        "history": [],
        "targets": [{"date": "2026-11-04", "meal_period": "LUNCH"}],
    }
    response = client.post("/ai/predict-surplus", json=body, headers=AUTH)
    assert response.status_code == 503
    assert_envelope(response.json(), "MODEL_UNAVAILABLE")


# --------------------------------------------------------------------------- auth


@pytest.mark.parametrize("path", PROTECTED)
def test_protected_endpoints_require_token(client: TestClient, path: str) -> None:
    response = client.post(path, json={})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert_envelope(response.json(), "UNAUTHORIZED")


@pytest.mark.parametrize(
    "header",
    [
        "Bearer wrong-token-" + "y" * 32,
        f"Basic {TOKEN}",
        "Bearer",
        TOKEN,
        f"Bearer {TOKEN}extra",
    ],
)
def test_wrong_or_malformed_token_is_rejected(client: TestClient, header: str) -> None:
    response = client.post("/ai/match-ngos", json={}, headers={"Authorization": header})
    assert response.status_code == 401
    assert_envelope(response.json(), "UNAUTHORIZED")


def test_openapi_schema_requires_auth(client: TestClient) -> None:
    assert client.get("/ai/openapi.json").status_code == 401
    schema = client.get("/ai/openapi.json", headers=AUTH).json()
    assert "/ai/match-ngos" in schema["paths"]
    assert client.get("/docs").status_code == 404


# --------------------------------------------------------------------------- error envelope


def test_validation_error_envelope(client: TestClient) -> None:
    response = client.post("/ai/match-ngos", json={"donation": {}}, headers=AUTH)
    assert response.status_code == 422
    error = assert_envelope(response.json(), "VALIDATION_ERROR")
    locs = [tuple(d["loc"]) for d in error["details"]]
    assert ("body", "candidates") in locs
    assert all("input" not in d for d in error["details"])


def test_invalid_json_is_validation_error(client: TestClient) -> None:
    response = client.post(
        "/ai/insights",
        content=b"{not json",
        headers={**AUTH, "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert_envelope(response.json(), "VALIDATION_ERROR")


def test_unknown_fields_are_rejected(client: TestClient) -> None:
    body = {"audience": "ADMIN", "data_label": "REAL", "unexpected": 1}
    response = client.post("/ai/insights", json=body, headers=AUTH)
    assert response.status_code == 422


def test_404_and_405_use_envelope(client: TestClient) -> None:
    not_found = client.get("/ai/does-not-exist", headers=AUTH)
    assert not_found.status_code == 404
    assert_envelope(not_found.json(), "NOT_FOUND")
    not_allowed = client.get("/ai/match-ngos", headers=AUTH)
    assert not_allowed.status_code == 405
    assert_envelope(not_allowed.json(), "METHOD_NOT_ALLOWED")


def test_unhandled_exception_returns_500_envelope(app_factory: Callable[..., TestClient]) -> None:
    app = create_app(make_settings())

    @app.get("/ai/boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail")

    client = app_factory(app=app)
    response = client.get("/ai/boom", headers={"X-Request-Id": "trace-500"})
    assert response.status_code == 500
    error = assert_envelope(response.json(), "INTERNAL_ERROR")
    assert error["request_id"] == "trace-500"
    assert response.headers["x-request-id"] == "trace-500"
    assert "secret internal detail" not in response.text


# --------------------------------------------------------------------------- request id


def test_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/ai/health", headers={"X-Request-Id": "abc-123"})
    assert response.headers["x-request-id"] == "abc-123"
    error = client.post("/ai/insights", json={}, headers={**AUTH, "X-Request-Id": "abc-124"})
    assert error.json()["error"]["request_id"] == "abc-124"
    assert error.headers["x-request-id"] == "abc-124"


def test_request_id_is_generated_when_missing_or_invalid(client: TestClient) -> None:
    generated = client.get("/ai/health").headers["x-request-id"]
    assert len(generated) == 36
    replaced = client.get("/ai/health", headers={"X-Request-Id": "bad id with spaces"})
    assert replaced.headers["x-request-id"] != "bad id with spaces"


# --------------------------------------------------------------------------- body limit


def test_body_over_1mb_is_rejected_with_413(client: TestClient) -> None:
    payload = b'{"x": "' + b"a" * (1024 * 1024) + b'"}'
    response = client.post(
        "/ai/insights", content=payload, headers={**AUTH, "Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert_envelope(response.json(), "PAYLOAD_TOO_LARGE")
    assert "x-request-id" in response.headers


def test_chunked_body_over_limit_is_rejected(client: TestClient) -> None:
    def chunks():  # no Content-Length header: streamed body
        for _ in range(17):
            yield b"a" * 65536

    response = client.post(
        "/ai/insights", content=chunks(), headers={**AUTH, "Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_body_under_limit_is_accepted(client: TestClient) -> None:
    body = {"audience": "ADMIN", "data_label": "REAL", "series": {}}
    assert client.post("/ai/insights", json=body, headers=AUTH).status_code == 200


# --------------------------------------------------------------------------- config & logging


def test_token_must_be_at_least_32_chars() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, internal_service_token="too-short")


def test_config_error_does_not_echo_secret(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)  # no .env files here
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "short-secret-value")
    with pytest.raises(ConfigurationError) as info:
        load_settings()
    assert "INTERNAL_SERVICE_TOKEN" in str(info.value)
    assert "short-secret-value" not in str(info.value)


def test_settings_from_env_and_empty_values_use_defaults(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_PROVIDER", "Gemini")
    monkeypatch.setenv("GEMINI_MODEL", "")
    monkeypatch.setenv("LOG_LEVEL", "info")
    settings = load_settings()
    assert settings.llm_provider == "gemini"
    assert settings.gemini_model == "gemini-2.5-flash"
    assert settings.log_level == "INFO"
    assert settings.llm_configured is False  # no key


def test_json_formatter_redacts_sensitive_keys() -> None:
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "event", (), None)
    record.authorization = f"Bearer {TOKEN}"
    record.api_key = "sk-secret"
    record.provider = "openai"
    line = json.loads(JsonFormatter().format(record))
    assert line["authorization"] == "[REDACTED]"
    assert line["api_key"] == "[REDACTED]"
    assert line["provider"] == "openai"


def test_request_logs_do_not_contain_token_or_body(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="app.access")
    body = {"audience": "ADMIN", "data_label": "REAL", "series": {}}
    client.post("/ai/insights", json=body, headers={**AUTH, "X-Request-Id": "log-1"})
    formatted = "\n".join(JsonFormatter().format(r) for r in caplog.records)
    assert "/ai/insights" in formatted
    assert TOKEN not in formatted
    assert "ADMIN" not in formatted
