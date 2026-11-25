from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, model_validator

from app.schemas.common import ResponseModel, StrictModel

MAX_MESSAGES = 100
MAX_CONTENT_CHARS = 32_000
MAX_TOOLS = 64
TOOL_NAME_PATTERN = r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$"
CALL_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,128}$"


class ToolCall(StrictModel):
    id: str = Field(pattern=CALL_ID_PATTERN)
    name: str = Field(pattern=TOOL_NAME_PATTERN)
    arguments: dict[str, Any] = Field(default_factory=dict)


class ChatMessage(StrictModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = Field(default=None, max_length=MAX_CONTENT_CHARS)
    tool_calls: list[ToolCall] | None = Field(default=None, max_length=32)
    tool_call_id: str | None = Field(default=None, pattern=CALL_ID_PATTERN)
    name: str | None = Field(default=None, pattern=TOOL_NAME_PATTERN)

    @model_validator(mode="after")
    def _role_fields(self) -> ChatMessage:
        if self.role in ("system", "user") and not self.content:
            raise ValueError(f"{self.role} messages need content")
        if self.role != "assistant" and self.tool_calls:
            raise ValueError("only assistant messages can have tool_calls")
        if self.role == "assistant" and not self.content and not self.tool_calls:
            raise ValueError("assistant messages need content or tool_calls")
        if self.role == "tool":
            if not self.tool_call_id:
                raise ValueError("tool messages need tool_call_id")
            if self.content is None:
                raise ValueError("tool messages need content")
        elif self.tool_call_id is not None:
            raise ValueError("only tool messages can have tool_call_id")
        return self


class ToolDefinition(StrictModel):
    name: str = Field(pattern=TOOL_NAME_PATTERN)
    description: str = Field(min_length=1, max_length=2000)
    parameters: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})


class AssistantRequest(StrictModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    tools: list[ToolDefinition] = Field(default_factory=list, max_length=MAX_TOOLS)
    temperature: float = Field(default=0.2, ge=0, le=2)

    @model_validator(mode="after")
    def _consistent(self) -> AssistantRequest:
        names = [t.name for t in self.tools]
        if len(set(names)) != len(names):
            raise ValueError("tool names must be unique")
        known_calls: dict[str, str] = {}
        for message in self.messages:
            for call in message.tool_calls or []:
                known_calls[call.id] = call.name
            if message.role == "tool" and message.tool_call_id not in known_calls:
                raise ValueError(
                    f"tool message references unknown tool_call_id {message.tool_call_id}"
                )
        if not any(m.role == "user" for m in self.messages):
            raise ValueError("at least one user message is required")
        return self

    def tool_name_for_call(self, call_id: str) -> str | None:
        for message in self.messages:
            for call in message.tool_calls or []:
                if call.id == call_id:
                    return call.name
        return None


class Usage(ResponseModel):
    prompt_tokens: int
    completion_tokens: int


class AssistantMessageResponse(ResponseModel):
    type: Literal["message"] = "message"
    content: str
    provider: str
    model: str
    usage: Usage


class AssistantToolCallsResponse(ResponseModel):
    type: Literal["tool_calls"] = "tool_calls"
    calls: list[ToolCall]
    provider: str
    model: str
    usage: Usage


AssistantResponse = AssistantMessageResponse | AssistantToolCallsResponse
