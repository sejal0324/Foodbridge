"""One assistant inference step: choose the provider, call it once, police the result.

The AI service never executes tools. It only returns tool calls whose names
are in the request's ``tools`` list; the backend checks permissions, validates
arguments and executes them as the authenticated user.
"""

from __future__ import annotations

import httpx

from app.core.config import Settings
from app.core.errors import AppError
from app.schemas.assistant import (
    AssistantMessageResponse,
    AssistantRequest,
    AssistantResponse,
    AssistantToolCallsResponse,
    ToolCall,
    Usage,
)
from app.services.llm_providers import GeminiProvider, LLMProvider, OpenAIProvider, ProviderError


def build_provider(settings: Settings, client: httpx.AsyncClient) -> LLMProvider | None:
    """The configured provider, or None when the assistant is unavailable."""
    if not settings.llm_configured:
        return None
    if settings.llm_provider == "openai" and settings.openai_api_key is not None:
        return OpenAIProvider(
            client,
            settings.openai_api_key.get_secret_value(),
            settings.openai_model,
            settings.llm_timeout_s,
        )
    if settings.llm_provider == "gemini" and settings.gemini_api_key is not None:
        return GeminiProvider(
            client,
            settings.gemini_api_key.get_secret_value(),
            settings.gemini_model,
            settings.llm_timeout_s,
        )
    return None


def _provider_error(code: str, message: str, provider_status: int | None = None) -> AppError:
    details: dict[str, object] = {"code": code}
    if provider_status is not None:
        details["provider_status"] = provider_status
    return AppError(502, "LLM_PROVIDER_ERROR", message, details)


async def assistant_step(
    request: AssistantRequest, provider: LLMProvider | None
) -> AssistantResponse:
    if provider is None:
        raise AppError(
            503,
            "LLM_UNAVAILABLE",
            "The assistant is unavailable: no language model provider is configured.",
        )
    try:
        result = await provider.complete(request)
    except ProviderError as exc:
        raise _provider_error(exc.code, exc.message, exc.provider_status) from exc

    usage = Usage(prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens)
    if result.calls:
        offered = {tool.name for tool in request.tools}
        unknown = sorted({call.name[:64] for call in result.calls if call.name not in offered})
        if unknown:
            raise AppError(
                502,
                "LLM_PROVIDER_ERROR",
                "The model requested a tool that was not offered.",
                {"code": "UNKNOWN_TOOL", "tool_names": unknown},
            )
        return AssistantToolCallsResponse(
            calls=[
                ToolCall(id=call.id, name=call.name, arguments=call.arguments)
                for call in result.calls
            ],
            provider=provider.name,
            model=provider.model,
            usage=usage,
        )
    if not result.content or not result.content.strip():
        raise _provider_error("EMPTY_RESPONSE", "The language model returned an empty response.")
    return AssistantMessageResponse(
        content=result.content,
        provider=provider.name,
        model=provider.model,
        usage=usage,
    )
