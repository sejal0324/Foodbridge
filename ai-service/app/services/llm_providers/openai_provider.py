"""OpenAI Chat Completions adapter (function calling)."""

from __future__ import annotations

import json
from typing import Any

from app.schemas.assistant import AssistantRequest
from app.services.llm_providers.base import (
    LLMProvider,
    LLMResult,
    ProviderError,
    RawToolCall,
    as_int,
    stable_call_id,
    valid_call_id,
)

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


def _messages(request: AssistantRequest) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for message in request.messages:
        if message.role == "tool":
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": message.tool_call_id,
                    "content": message.content or "",
                }
            )
        elif message.role == "assistant" and message.tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.arguments),
                            },
                        }
                        for call in message.tool_calls
                    ],
                }
            )
        else:
            messages.append({"role": message.role, "content": message.content})
    return messages


def build_payload(request: AssistantRequest, model: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": _messages(request),
        "temperature": request.temperature,
    }
    if request.tools:
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            for tool in request.tools
        ]
        payload["tool_choice"] = "auto"
    return payload


def parse_response(data: dict[str, Any], request: AssistantRequest) -> LLMResult:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ProviderError("MALFORMED_RESPONSE", "Provider response has no choices.")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ProviderError("MALFORMED_RESPONSE", "Provider response has no message.")

    calls: list[RawToolCall] = []
    raw_calls = message.get("tool_calls") or []
    if not isinstance(raw_calls, list):
        raise ProviderError("MALFORMED_RESPONSE", "Provider tool_calls is not a list.")
    for index, raw in enumerate(raw_calls):
        function = raw.get("function") if isinstance(raw, dict) else None
        if not isinstance(function, dict) or not isinstance(function.get("name"), str):
            raise ProviderError("MALFORMED_RESPONSE", "Provider returned a malformed tool call.")
        try:
            arguments = json.loads(function.get("arguments") or "{}")
        except (TypeError, ValueError) as exc:
            raise ProviderError(
                "MALFORMED_RESPONSE", "Provider returned tool arguments that are not valid JSON."
            ) from exc
        if not isinstance(arguments, dict):
            raise ProviderError("MALFORMED_RESPONSE", "Tool arguments must be a JSON object.")
        call_id = raw.get("id")
        if not valid_call_id(call_id):
            call_id = stable_call_id(request, index, function["name"], arguments)
        calls.append(RawToolCall(id=str(call_id), name=function["name"], arguments=arguments))

    content = message.get("content")
    if not isinstance(content, str):
        refusal = message.get("refusal")
        content = refusal if isinstance(refusal, str) else None
    raw_usage = data.get("usage")
    usage: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
    return LLMResult(
        content=content,
        calls=calls,
        prompt_tokens=as_int(usage.get("prompt_tokens")),
        completion_tokens=as_int(usage.get("completion_tokens")),
    )


class OpenAIProvider(LLMProvider):
    name = "openai"

    async def complete(self, request: AssistantRequest) -> LLMResult:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        data = await self._post_json(OPENAI_CHAT_URL, headers, build_payload(request, self.model))
        return parse_response(data, request)
