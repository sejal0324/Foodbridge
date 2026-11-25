"""Pure-ASGI middleware: request id, body size limit, access log, last-resort 500.

Implemented at the ASGI level (not BaseHTTPMiddleware) so that the request body
can be bounded before FastAPI parses it, and so that every response, including
errors, carries ``X-Request-Id``.
"""

from __future__ import annotations

import json
import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import error_body
from app.core.request_context import new_request_id, reset_request_id, set_request_id

logger = logging.getLogger("app.access")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        request_id = new_request_id(headers.get("x-request-id"))
        scope.setdefault("state", {})["request_id"] = request_id
        token = set_request_id(request_id)
        started = time.perf_counter()
        response_status = 0
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal response_status, response_started
            if message["type"] == "http.response.start":
                response_status = int(message["status"])
                response_started = True
                response_headers = list(message.get("headers", []))
                response_headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": response_headers}
            await send(message)

        try:
            body_receive = await self._bounded_receive(headers, receive)
            if body_receive is None:
                await self._send_error(
                    send_with_request_id,
                    413,
                    "PAYLOAD_TOO_LARGE",
                    f"Request body exceeds {self.max_body_bytes} bytes.",
                )
            else:
                await self.app(scope, body_receive, send_with_request_id)
        except Exception:
            logger.exception("unhandled_error", extra={"path": scope.get("path")})
            if not response_started:
                await self._send_error(
                    send_with_request_id, 500, "INTERNAL_ERROR", "An unexpected error occurred."
                )
        finally:
            logger.info(
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": response_status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            reset_request_id(token)

    async def _bounded_receive(self, headers: dict[str, str], receive: Receive) -> Receive | None:
        """Read the body up to the limit. Returns a replaying receive, or None if too large."""
        declared = headers.get("content-length", "")
        if declared.isdigit() and int(declared) > self.max_body_bytes:
            return None  # reject before reading anything

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                # Client went away; let the app observe the disconnect.
                async def disconnected(event: Message = message) -> Message:
                    return event

                return disconnected
            body = message.get("body", b"")
            size += len(body)
            if size > self.max_body_bytes:
                return None
            chunks.append(body)
            if not message.get("more_body", False):
                break

        replayed = False
        full_body = b"".join(chunks)

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": full_body, "more_body": False}
            return await receive()

        return replay

    @staticmethod
    async def _send_error(send: Send, status: int, code: str, message: str) -> None:
        body = json.dumps(error_body(code, message)).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
