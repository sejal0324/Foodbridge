"""POST /ai/assistant with mocked OpenAI and Gemini HTTP APIs (no real calls)."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.services.llm_providers import base as provider_base
from tests.conftest import AUTH

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
)
OPENAI_KEY = "sk-test-openai-key-never-leaked"
GEMINI_KEY = "gm-test-gemini-key-never-leaked"

TOOLS = [
    {
        "name": "search_donations",
        "description": "Search the user's donations.",
        "parameters": {
            "type": "object",
            "properties": {"status": {"type": "string"}},
            "additionalProperties": False,
        },
    }
]


def conversation(with_tool_turn: bool = False) -> dict[str, Any]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "You are the FoodBridge assistant."},
        {"role": "user", "content": "Show my donations"},
    ]
    if with_tool_turn:
        messages += [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "name": "search_donations",
                        "arguments": {"status": "AVAILABLE"},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call_1",
                "name": "search_donations",
                "content": json.dumps({"items": [{"id": "d1", "quantity": 40}]}),
            },
        ]
    return {"messages": messages, "tools": TOOLS, "temperature": 0.2}


@pytest.fixture(autouse=True)
def _no_retry_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provider_base, "RETRY_DELAY_S", 0.0)


@pytest.fixture
def mock_http() -> Iterator[respx.MockRouter]:
    # Any request that is not explicitly mocked fails the test: no real network.
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        yield router


@pytest.fixture
def openai_client(app_factory: Callable[..., TestClient]) -> TestClient:
    return app_factory(llm_provider="openai", openai_api_key=OPENAI_KEY)


@pytest.fixture
def gemini_client(app_factory: Callable[..., TestClient]) -> TestClient:
    return app_factory(llm_provider="gemini", gemini_api_key=GEMINI_KEY)


def post(client: TestClient, body: dict[str, Any]) -> httpx.Response:
    response = client.post("/ai/assistant", json=body, headers=AUTH)
    assert OPENAI_KEY not in response.text and GEMINI_KEY not in response.text
    return response


def provider_error(response: httpx.Response, code: str) -> dict[str, Any]:
    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "LLM_PROVIDER_ERROR"
    assert error["details"]["code"] == code
    return error


# --------------------------------------------------------------------------- unconfigured


def test_unconfigured_provider_returns_503(client: TestClient) -> None:
    response = post(client, conversation())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "LLM_UNAVAILABLE"


@pytest.mark.parametrize("provider", ["openai", "gemini"])
def test_provider_without_key_returns_503(
    app_factory: Callable[..., TestClient], provider: str
) -> None:
    client = app_factory(llm_provider=provider)
    assert post(client, conversation()).status_code == 503


# --------------------------------------------------------------------------- OpenAI


def openai_reply(message: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": "chatcmpl-1",
        "choices": [
            {"index": 0, "message": {"role": "assistant", **message}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 42, "completion_tokens": 7, "total_tokens": 49},
    }


def test_openai_text_answer(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    route = mock_http.post(OPENAI_URL).mock(
        return_value=httpx.Response(200, json=openai_reply({"content": "You have 1 donation."}))
    )
    response = post(openai_client, conversation(with_tool_turn=True))
    assert response.status_code == 200
    assert response.json() == {
        "type": "message",
        "content": "You have 1 donation.",
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "usage": {"prompt_tokens": 42, "completion_tokens": 7},
    }
    sent = route.calls.last.request
    assert sent.headers["authorization"] == f"Bearer {OPENAI_KEY}"
    payload = json.loads(sent.content)
    assert payload["model"] == "gpt-4.1-mini"
    assert payload["temperature"] == 0.2
    assert payload["tools"][0] == {"type": "function", "function": TOOLS[0]}
    roles = [m["role"] for m in payload["messages"]]
    assert roles == ["system", "user", "assistant", "tool"]
    assistant_msg = payload["messages"][2]
    assert assistant_msg["tool_calls"][0]["function"] == {
        "name": "search_donations",
        "arguments": json.dumps({"status": "AVAILABLE"}),
    }
    assert payload["messages"][3]["tool_call_id"] == "call_1"


def test_openai_tool_call(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(OPENAI_URL).mock(
        return_value=httpx.Response(
            200,
            json=openai_reply(
                {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_abc",
                            "type": "function",
                            "function": {
                                "name": "search_donations",
                                "arguments": '{"status": "AVAILABLE"}',
                            },
                        }
                    ],
                }
            ),
        )
    )
    response = post(openai_client, conversation())
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "tool_calls"
    assert body["calls"] == [
        {"id": "call_abc", "name": "search_donations", "arguments": {"status": "AVAILABLE"}}
    ]
    assert body["provider"] == "openai"


def test_openai_invalid_tool_arguments_is_provider_error(
    openai_client: TestClient, mock_http: respx.MockRouter
) -> None:
    mock_http.post(OPENAI_URL).mock(
        return_value=httpx.Response(
            200,
            json=openai_reply(
                {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "c1",
                            "type": "function",
                            "function": {"name": "search_donations", "arguments": "{not json"},
                        }
                    ],
                }
            ),
        )
    )
    provider_error(post(openai_client, conversation()), "MALFORMED_RESPONSE")


def test_openai_malformed_response(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(OPENAI_URL).mock(return_value=httpx.Response(200, json={"unexpected": True}))
    provider_error(post(openai_client, conversation()), "MALFORMED_RESPONSE")


def test_openai_non_json_body(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(OPENAI_URL).mock(return_value=httpx.Response(200, text="<html>oops</html>"))
    provider_error(post(openai_client, conversation()), "MALFORMED_RESPONSE")


def test_openai_timeout(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    route = mock_http.post(OPENAI_URL).mock(side_effect=httpx.ReadTimeout("timed out"))
    provider_error(post(openai_client, conversation()), "TIMEOUT")
    assert route.call_count == 1


def test_openai_4xx_is_not_retried_and_body_not_leaked(
    openai_client: TestClient, mock_http: respx.MockRouter
) -> None:
    route = mock_http.post(OPENAI_URL).mock(
        return_value=httpx.Response(
            401, json={"error": {"message": f"Incorrect API key provided: {OPENAI_KEY}"}}
        )
    )
    response = post(openai_client, conversation())
    error = provider_error(response, "HTTP_ERROR")
    assert error["details"]["provider_status"] == 401
    assert "Incorrect API key" not in response.text
    assert route.call_count == 1


def test_openai_5xx_is_retried_once(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    route = mock_http.post(OPENAI_URL).mock(
        side_effect=[
            httpx.Response(503, json={"error": "busy"}),
            httpx.Response(200, json=openai_reply({"content": "Recovered."})),
        ]
    )
    response = post(openai_client, conversation())
    assert response.status_code == 200 and response.json()["content"] == "Recovered."
    assert route.call_count == 2


def test_openai_unknown_tool(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(OPENAI_URL).mock(
        return_value=httpx.Response(
            200,
            json=openai_reply(
                {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "c1",
                            "type": "function",
                            "function": {"name": "delete_everything", "arguments": "{}"},
                        }
                    ],
                }
            ),
        )
    )
    error = provider_error(post(openai_client, conversation()), "UNKNOWN_TOOL")
    assert error["details"]["tool_names"] == ["delete_everything"]


def test_openai_empty_answer(openai_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(OPENAI_URL).mock(
        return_value=httpx.Response(200, json=openai_reply({"content": ""}))
    )
    provider_error(post(openai_client, conversation()), "EMPTY_RESPONSE")


# --------------------------------------------------------------------------- Gemini


def gemini_reply(parts: list[dict[str, Any]], finish: str = "STOP") -> dict[str, Any]:
    return {
        "candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": finish}],
        "usageMetadata": {
            "promptTokenCount": 30,
            "candidatesTokenCount": 5,
            "thoughtsTokenCount": 3,
        },
        "modelVersion": "gemini-2.5-flash",
    }


def test_gemini_text_answer(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    route = mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(
            200,
            json=gemini_reply(
                [{"text": "thinking...", "thought": True}, {"text": "You have 1 donation."}]
            ),
        )
    )
    response = post(gemini_client, conversation(with_tool_turn=True))
    assert response.status_code == 200
    assert response.json() == {
        "type": "message",
        "content": "You have 1 donation.",
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "usage": {"prompt_tokens": 30, "completion_tokens": 8},
    }
    sent = route.calls.last.request
    assert sent.headers["x-goog-api-key"] == GEMINI_KEY
    assert "key=" not in str(sent.url)  # key only in the header, never in the URL
    payload = json.loads(sent.content)
    assert payload["systemInstruction"] == {
        "parts": [{"text": "You are the FoodBridge assistant."}]
    }
    assert payload["generationConfig"] == {"temperature": 0.2}
    declaration = payload["tools"][0]["functionDeclarations"][0]
    assert declaration["name"] == "search_donations"
    assert declaration["parametersJsonSchema"] == TOOLS[0]["parameters"]
    contents = payload["contents"]
    assert [c["role"] for c in contents] == ["user", "model", "user"]
    assert contents[1]["parts"] == [
        {"functionCall": {"name": "search_donations", "args": {"status": "AVAILABLE"}}}
    ]
    assert contents[2]["parts"] == [
        {
            "functionResponse": {
                "name": "search_donations",
                "response": {"items": [{"id": "d1", "quantity": 40}]},
            }
        }
    ]


def test_gemini_tool_call_gets_stable_id(
    gemini_client: TestClient, mock_http: respx.MockRouter
) -> None:
    mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(
            200,
            json=gemini_reply(
                [{"functionCall": {"name": "search_donations", "args": {"status": "AVAILABLE"}}}]
            ),
        )
    )
    first = post(gemini_client, conversation()).json()
    second = post(gemini_client, conversation()).json()
    assert first["type"] == "tool_calls"
    call = first["calls"][0]
    assert call["name"] == "search_donations"
    assert call["arguments"] == {"status": "AVAILABLE"}
    assert call["id"].startswith("call_")
    assert first == second  # deterministic id


def test_gemini_parallel_tool_responses_grouped(
    gemini_client: TestClient, mock_http: respx.MockRouter
) -> None:
    route = mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(200, json=gemini_reply([{"text": "Done."}]))
    )
    body = conversation()
    body["messages"] += [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {"id": "a", "name": "search_donations", "arguments": {}},
                {"id": "b", "name": "search_donations", "arguments": {"status": "EXPIRED"}},
            ],
        },
        {"role": "tool", "tool_call_id": "a", "content": "[1, 2]"},
        {"role": "tool", "tool_call_id": "b", "content": "not json"},
    ]
    assert post(gemini_client, body).status_code == 200
    contents = json.loads(route.calls.last.request.content)["contents"]
    responses = contents[-1]["parts"]
    assert [p["functionResponse"]["name"] for p in responses] == ["search_donations"] * 2
    assert responses[0]["functionResponse"]["response"] == {"result": [1, 2]}
    assert responses[1]["functionResponse"]["response"] == {"result": "not json"}


def test_gemini_malformed_response(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(GEMINI_URL).mock(return_value=httpx.Response(200, json={"candidates": []}))
    provider_error(post(gemini_client, conversation()), "MALFORMED_RESPONSE")


def test_gemini_bad_function_args(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(
            200, json=gemini_reply([{"functionCall": {"name": "search_donations", "args": "oops"}}])
        )
    )
    provider_error(post(gemini_client, conversation()), "MALFORMED_RESPONSE")


def test_gemini_blocked(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(200, json=gemini_reply([], finish="SAFETY"))
    )
    provider_error(post(gemini_client, conversation()), "BLOCKED")


def test_gemini_timeout(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(GEMINI_URL).mock(side_effect=httpx.ConnectTimeout("timed out"))
    provider_error(post(gemini_client, conversation()), "TIMEOUT")


def test_gemini_network_error_retried_then_fails(
    gemini_client: TestClient, mock_http: respx.MockRouter
) -> None:
    route = mock_http.post(GEMINI_URL).mock(side_effect=httpx.ConnectError("refused"))
    provider_error(post(gemini_client, conversation()), "NETWORK_ERROR")
    assert route.call_count == 2


def test_gemini_unknown_tool(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(
            200, json=gemini_reply([{"functionCall": {"name": "create_payment", "args": {}}}])
        )
    )
    provider_error(post(gemini_client, conversation()), "UNKNOWN_TOOL")


def test_gemini_http_error(gemini_client: TestClient, mock_http: respx.MockRouter) -> None:
    mock_http.post(GEMINI_URL).mock(
        return_value=httpx.Response(
            400, json={"error": {"message": f"API key {GEMINI_KEY} not valid"}}
        )
    )
    error = provider_error(post(gemini_client, conversation()), "HTTP_ERROR")
    assert error["details"]["provider_status"] == 400


# --------------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "messages",
    [
        [],
        [{"role": "system", "content": "only a system prompt"}],
        [
            {"role": "user", "content": "hi"},
            {"role": "tool", "tool_call_id": "nope", "content": "{}"},
        ],
        [{"role": "user", "content": None}],
        [{"role": "robot", "content": "hi"}],
        [{"role": "user", "content": "x" * 32_001}],
    ],
)
def test_invalid_conversations_are_422(openai_client: TestClient, messages: list) -> None:
    response = openai_client.post(
        "/ai/assistant", json={"messages": messages, "tools": TOOLS}, headers=AUTH
    )
    assert response.status_code == 422


def test_duplicate_tool_names_are_422(openai_client: TestClient) -> None:
    body = {**conversation(), "tools": TOOLS + TOOLS}
    assert openai_client.post("/ai/assistant", json=body, headers=AUTH).status_code == 422
