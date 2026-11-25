"""LLM provider interface and shared HTTP handling.

A provider performs exactly one model call and returns either text or tool
calls. It never executes tools. API keys go only into request headers and are
never logged or returned; provider error bodies are discarded because they can
echo credentials.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.schemas.assistant import AssistantRequest

logger = logging.getLogger("app.llm")

RETRYABLE_STATUS = frozenset({500, 502, 503, 504})
RETRY_DELAY_S = 0.5
_CALL_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class ProviderError(Exception):
    """A provider call failed. ``code`` is safe to return to the backend."""

    def __init__(self, code: str, message: str, provider_status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.provider_status = provider_status


@dataclass(frozen=True)
class RawToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class LLMResult:
    content: str | None
    calls: list[RawToolCall] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0


def stable_call_id(request: AssistantRequest, index: int, name: str, args: dict[str, Any]) -> str:
    """Deterministic id for providers that do not return one (Gemini)."""
    seed = f"{len(request.messages)}:{index}:{name}:{json.dumps(args, sort_keys=True)}"
    return "call_" + hashlib.sha256(seed.encode()).hexdigest()[:24]


def valid_call_id(value: object) -> bool:
    return isinstance(value, str) and bool(_CALL_ID.match(value))


def as_int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


class LLMProvider(ABC):
    name: str

    def __init__(
        self, client: httpx.AsyncClient, api_key: str, model: str, timeout_s: float
    ) -> None:
        self._client = client
        self._api_key = api_key
        self.model = model
        self._timeout = timeout_s

    @abstractmethod
    async def complete(self, request: AssistantRequest) -> LLMResult:
        """Run one inference step."""

    async def _post_json(
        self, url: str, headers: dict[str, str], payload: dict[str, Any]
    ) -> dict[str, Any]:
        """POST with one retry on 5xx/connection errors; never on 4xx or timeouts."""
        started = time.perf_counter()
        response: httpx.Response | None = None
        for attempt in range(2):
            try:
                response = await self._client.post(
                    url, headers=headers, json=payload, timeout=self._timeout
                )
            except httpx.TimeoutException as exc:
                self._log("timeout", started)
                raise ProviderError("TIMEOUT", "The language model provider timed out.") from exc
            except httpx.TransportError as exc:
                if attempt == 0:
                    await asyncio.sleep(RETRY_DELAY_S)
                    continue
                self._log("network_error", started)
                raise ProviderError(
                    "NETWORK_ERROR", "Could not reach the language model provider."
                ) from exc
            if response.status_code in RETRYABLE_STATUS and attempt == 0:
                await asyncio.sleep(RETRY_DELAY_S)
                continue
            break
        if response is None:  # unreachable: the loop assigns or raises
            raise ProviderError("NETWORK_ERROR", "Could not reach the language model provider.")
        self._log("response", started, response.status_code)
        if response.status_code >= 400:
            raise ProviderError(
                "HTTP_ERROR",
                f"The language model provider returned HTTP {response.status_code}.",
                provider_status=response.status_code,
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise ProviderError("MALFORMED_RESPONSE", "Provider returned invalid JSON.") from exc
        if not isinstance(data, dict):
            raise ProviderError("MALFORMED_RESPONSE", "Provider returned an unexpected payload.")
        return data

    def _log(self, event: str, started: float, status: int | None = None) -> None:
        logger.info(
            "llm_call",
            extra={
                "event": event,
                "provider": self.name,
                "model": self.model,
                "provider_status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
