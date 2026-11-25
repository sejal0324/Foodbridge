"""Per-request context (request id) shared by middleware, logging and errors."""

from __future__ import annotations

import re
import uuid
from contextvars import ContextVar, Token

_REQUEST_ID: ContextVar[str | None] = ContextVar("request_id", default=None)
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def new_request_id(incoming: str | None) -> str:
    """Accept a well-formed incoming X-Request-Id, otherwise generate one."""
    if incoming and _VALID_REQUEST_ID.match(incoming):
        return incoming
    return str(uuid.uuid4())


def set_request_id(request_id: str | None) -> Token[str | None]:
    return _REQUEST_ID.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _REQUEST_ID.reset(token)


def get_request_id() -> str:
    """The current request id, or a fresh one outside a request."""
    value = _REQUEST_ID.get()
    return value if value is not None else str(uuid.uuid4())


def current_request_id() -> str | None:
    return _REQUEST_ID.get()
