"""Internal service authentication (backend -> AI service bearer token)."""

from __future__ import annotations

import hmac

from fastapi import Request

from app.core.config import Settings
from app.core.errors import AppError

_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


def _unauthorized(message: str) -> AppError:
    return AppError(401, "UNAUTHORIZED", message, headers=_UNAUTHORIZED_HEADERS)


async def require_service_token(request: Request) -> None:
    """FastAPI dependency: constant-time check of ``Authorization: Bearer <token>``."""
    settings: Settings = request.app.state.settings
    header = request.headers.get("authorization")
    if not header:
        raise _unauthorized("Missing service token.")
    scheme, _, supplied = header.partition(" ")
    if scheme.lower() != "bearer" or not supplied:
        raise _unauthorized("Invalid authorization scheme.")
    expected = settings.internal_service_token.get_secret_value()
    if not hmac.compare_digest(supplied.strip().encode(), expected.encode()):
        raise _unauthorized("Invalid service token.")
