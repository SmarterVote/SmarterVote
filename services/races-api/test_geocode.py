"""Tests for the public Census geocoding proxy used by My Ballot."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers import geocode
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

CENSUS_MATCH = {
    "result": {
        "addressMatches": [
            {
                "matchedAddress": "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
                "coordinates": {"x": -77.03, "y": 38.89},
                "geographies": {
                    "States": [{"NAME": "Texas", "STUSAB": "TX", "GEOID": "48"}],
                    "119th Congressional Districts": [
                        {
                            "CD119": "10",
                            "GEOID": "4810",
                            "BASENAME": "10",
                            "NAME": "Congressional District 10",
                            "AREALAND": 123,
                            "OID": 99,
                            "CENTLAT": "+30.1",
                        }
                    ],
                    "Census Tracts": [{"GEOID": "48453000100"}],
                },
            }
        ]
    }
}


class _FakeAsyncClient:
    """Stand-in for httpx.AsyncClient that records the outgoing request."""

    calls: list = []
    response: object = None
    error: Exception | None = None

    def __init__(self, *args, **kwargs):
        _FakeAsyncClient.init_kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None):
        _FakeAsyncClient.calls.append((url, params))
        if _FakeAsyncClient.error is not None:
            raise _FakeAsyncClient.error
        return _FakeAsyncClient.response


def _upstream(status=200, payload=None, bad_json=False):
    response = MagicMock()
    response.status_code = status
    if bad_json:
        response.json.side_effect = ValueError("not json")
    else:
        response.json.return_value = payload
    return response


@pytest.fixture
def client(monkeypatch):
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.error = None
    _FakeAsyncClient.response = _upstream(payload=CENSUS_MATCH)
    monkeypatch.setattr(geocode.httpx, "AsyncClient", _FakeAsyncClient)
    geocode.limiter.reset()
    app = FastAPI()
    app.state.limiter = geocode.limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(geocode.router)
    return TestClient(app)


def test_returns_state_and_raw_district_fields_only(client):
    resp = client.post("/geocode/census", json={"address": "  123 Main St,\tAustin, TX  "})
    assert resp.status_code == 200
    assert resp.json() == {
        "state": "Texas",
        "congressional_district": {
            "CD119": "10",
            "GEOID": "4810",
            "BASENAME": "10",
            "NAME": "Congressional District 10",
        },
    }
    assert resp.headers["Cache-Control"] == "no-store"
    assert "X-RateLimit-Limit" in resp.headers
    url, params = _FakeAsyncClient.calls[0]
    assert url == geocode.CENSUS_GEOGRAPHIES_URL
    assert params["format"] == "json"
    assert "callback" not in params
    assert params["address"] == "123 Main St, Austin, TX"
    assert _FakeAsyncClient.init_kwargs["timeout"] == geocode.CENSUS_TIMEOUT_SECONDS


def test_newer_congress_field_and_at_large_pass_through(client):
    _FakeAsyncClient.response = _upstream(
        payload={
            "result": {
                "addressMatches": [
                    {
                        "geographies": {
                            "States": [{"NAME": "Alaska"}],
                            "120th Congressional Districts": [
                                {"CD120": "00", "GEOID": "0200", "BASENAME": "Congressional District (at Large)"}
                            ],
                        }
                    }
                ]
            }
        }
    )
    body = client.post("/geocode/census", json={"address": "1 Main St, Juneau, AK"}).json()
    assert body["state"] == "Alaska"
    assert body["congressional_district"]["CD120"] == "00"


@pytest.mark.parametrize(
    "payload",
    [
        {"result": {"addressMatches": []}},
        {"result": {"addressMatches": [{"geographies": {"States": [{"NAME": "Texas"}]}}]}},
        {"result": {"addressMatches": [{"geographies": {"119th Congressional Districts": [{"CD119": "1"}]}}]}},
        {},
        [],
    ],
)
def test_no_match_is_404(client, payload):
    _FakeAsyncClient.response = _upstream(payload=payload)
    resp = client.post("/geocode/census", json={"address": "nowhere at all"})
    assert resp.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"address": "x" * 201},
        {"address": "  "},
        {"address": "ab"},
        {"address": "123 Main\x00St"},
        {},
        {"address": "123 Main St", "extra": True},
        {"address": 12345},
    ],
)
def test_rejects_invalid_input_without_calling_census(client, body):
    resp = client.post("/geocode/census", json=body)
    assert resp.status_code == 422
    assert _FakeAsyncClient.calls == []


def test_get_with_query_string_is_not_supported(client):
    # Addresses must never travel in a URL (request logs record query strings).
    assert client.get("/geocode/census", params={"address": "123 Main St"}).status_code == 405


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (httpx.ReadTimeout("slow"), 504),
        (httpx.ConnectError("down"), 502),
    ],
)
def test_upstream_transport_errors(client, error, status):
    _FakeAsyncClient.error = error
    assert client.post("/geocode/census", json={"address": "123 Main St"}).status_code == status


def test_upstream_http_error_and_bad_json_are_502(client):
    _FakeAsyncClient.response = _upstream(status=500, payload={})
    assert client.post("/geocode/census", json={"address": "123 Main St"}).status_code == 502
    _FakeAsyncClient.response = _upstream(bad_json=True)
    assert client.post("/geocode/census", json={"address": "123 Main St"}).status_code == 502


def test_address_is_never_logged(client, caplog):
    _FakeAsyncClient.error = httpx.ConnectError("failed for https://census/?address=123+Secret+Ln")
    with caplog.at_level("DEBUG"):
        client.post("/geocode/census", json={"address": "123 Secret Ln, Austin, TX"})
    assert "Secret" not in caplog.text


def test_rate_limited(client):
    statuses = [client.post("/geocode/census", json={"address": "123 Main St"}).status_code for _ in range(21)]
    assert statuses[:20] == [200] * 20
    assert statuses[20] == 429


def test_registered_on_main_app_without_auth():
    import main

    # The limit is checked off the event loop before body validation, so an
    # invalid request also spends budget; start from a clean window.
    geocode.limiter.reset()
    # No credentials: validation (422) runs, so the route exists and is not
    # behind auth (which would answer 401/403 first).
    with TestClient(main.app) as test_client:
        assert test_client.post("/geocode/census", json={}).status_code == 422
