"""Structured JSON logging.

Log records carry the request id. Request bodies, prompts, tokens and API keys
are never logged: callers pass only metadata through ``extra``.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, TextIO

from app.core.request_context import current_request_id

# Attributes that exist on every LogRecord; everything else came from ``extra``.
_STANDARD_ATTRS = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
    | {"message", "asctime", "taskName"}
)
# Defence in depth: never emit these keys even if a caller passes them.
_REDACTED_KEYS = frozenset(
    {"authorization", "token", "api_key", "apikey", "password", "secret", "prompt", "messages"}
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = current_request_id()
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key in _STANDARD_ATTRS or key.startswith("_"):
                continue
            payload[key] = "[REDACTED]" if key.lower() in _REDACTED_KEYS else value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class _JsonHandler(logging.StreamHandler[TextIO]):
    """Marker class so repeated configuration replaces only our own handler."""


def configure_logging(level: str) -> None:
    handler = _JsonHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [h for h in root.handlers if not isinstance(h, _JsonHandler)]
    root.addHandler(handler)
    root.setLevel(level)

    # Route uvicorn's own loggers through the JSON handler. The request
    # middleware writes one access line per request, so uvicorn's access log
    # is silenced to avoid duplicates.
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = []
        uv_logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers = []
    access.propagate = False
    access.disabled = True
