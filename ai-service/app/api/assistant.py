from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_llm_provider
from app.core.security import require_service_token
from app.schemas.assistant import (
    AssistantMessageResponse,
    AssistantRequest,
    AssistantResponse,
    AssistantToolCallsResponse,
)
from app.services.llm_providers import LLMProvider
from app.services.llm_service import assistant_step

router = APIRouter(prefix="/ai", tags=["assistant"], dependencies=[Depends(require_service_token)])


@router.post(
    "/assistant",
    response_model=AssistantMessageResponse | AssistantToolCallsResponse,
)
async def assistant_endpoint(
    body: AssistantRequest,
    provider: Annotated[LLMProvider | None, Depends(get_llm_provider)],
) -> AssistantResponse:
    """One LLM inference step. Returns a message or tool calls; never executes tools."""
    return await assistant_step(body, provider)
