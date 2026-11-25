"""Google Gemini ``generateContent`` adapter (function calling)."""

from __future__ import annotations

import json
from typing import Any

from app.schemas.assistant import AssistantRequest, ChatMessage
from app.services.llm_providers.base import (
    LLMProvider,
    LLMResult,
    ProviderError,
    RawToolCall,
    as_int,
    stable_call_id,
    valid_call_id,
)

GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
BLOCK_REASONS = frozenset(
    {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"}
)


def _function_response(message: ChatMessage, request: AssistantRequest) -> dict[str, Any]:
    name = message.name or request.tool_name_for_call(message.tool_call_id or "") or "tool"
    try:
        parsed: Any = json.loads(message.content or "null")
    except ValueError:
        parsed = message.content
    # functionResponse.response must be a JSON object.
    response = parsed if isinstance(parsed, dict) else {"result": parsed}
    return {"functionResponse": {"name": name, "response": response}}


def _contents(request: AssistantRequest) -> list[dict[str, Any]]:
    contents: list[dict[str, Any]] = []
    for message in request.messages:
        if message.role == "system":
            continue
        if message.role == "tool":
            part = _function_response(message, request)
            previous = contents[-1] if contents else None
            # Responses to parallel calls go together in one turn.
            if previous and previous.get("_tool_turn"):
                previous["parts"].append(part)
            else:
                contents.append({"role": "user", "parts": [part], "_tool_turn": True})
            continue
        if message.role == "user":
            contents.append({"role": "user", "parts": [{"text": message.content}]})
            continue
        parts: list[dict[str, Any]] = []
        if message.content:
            parts.append({"text": message.content})
        for call in message.tool_calls or []:
            parts.append({"functionCall": {"name": call.name, "args": call.arguments}})
        contents.append({"role": "model", "parts": parts})
    for content in contents:
        content.pop("_tool_turn", None)
    return contents


def build_payload(request: AssistantRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "contents": _contents(request),
        "generationConfig": {"temperature": request.temperature},
    }
    system = "\n\n".join(m.content or "" for m in request.messages if m.role == "system")
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    if request.tools:
        payload["tools"] = [
            {
                "functionDeclarations": [
                    {
                        "name": tool.name,
                        "description": tool.description,
                        # Full JSON Schema (supports additionalProperties etc.).
                        "parametersJsonSchema": tool.parameters,
                    }
                    for tool in request.tools
                ]
            }
        ]
    return payload


def parse_response(data: dict[str, Any], request: AssistantRequest) -> LLMResult:
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        feedback = data.get("promptFeedback")
        if isinstance(feedback, dict) and feedback.get("blockReason"):
            raise ProviderError("BLOCKED", "The provider blocked the prompt.")
        raise ProviderError("MALFORMED_RESPONSE", "Provider response has no candidates.")
    candidate = candidates[0]
    if not isinstance(candidate, dict):
        raise ProviderError("MALFORMED_RESPONSE", "Provider candidate is malformed.")
    raw_content = candidate.get("content")
    content: dict[str, Any] = raw_content if isinstance(raw_content, dict) else {}
    parts = content.get("parts") or []
    if not isinstance(parts, list):
        raise ProviderError("MALFORMED_RESPONSE", "Provider content parts are malformed.")

    texts: list[str] = []
    calls: list[RawToolCall] = []
    for part in parts:
        if not isinstance(part, dict) or part.get("thought"):
            continue
        if isinstance(part.get("text"), str):
            texts.append(part["text"])
        function_call = part.get("functionCall")
        if function_call is None:
            continue
        if not isinstance(function_call, dict) or not isinstance(function_call.get("name"), str):
            raise ProviderError(
                "MALFORMED_RESPONSE", "Provider returned a malformed function call."
            )
        args = function_call.get("args") or {}
        if not isinstance(args, dict):
            raise ProviderError("MALFORMED_RESPONSE", "Function call args must be a JSON object.")
        call_id = function_call.get("id")
        if not valid_call_id(call_id):
            call_id = stable_call_id(request, len(calls), function_call["name"], args)
        calls.append(RawToolCall(id=str(call_id), name=function_call["name"], arguments=args))

    if not texts and not calls and candidate.get("finishReason") in BLOCK_REASONS:
        raise ProviderError("BLOCKED", "The provider blocked the response.")
    raw_usage = data.get("usageMetadata")
    usage: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
    return LLMResult(
        content="".join(texts) if texts else None,
        calls=calls,
        prompt_tokens=as_int(usage.get("promptTokenCount")),
        completion_tokens=as_int(usage.get("candidatesTokenCount"))
        + as_int(usage.get("thoughtsTokenCount")),
    )


class GeminiProvider(LLMProvider):
    name = "gemini"

    async def complete(self, request: AssistantRequest) -> LLMResult:
        url = GEMINI_URL_TEMPLATE.format(model=self.model)
        headers = {"x-goog-api-key": self._api_key}
        data = await self._post_json(url, headers, build_payload(request))
        return parse_response(data, request)
