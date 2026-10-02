"""CORS origin policy tests for the races API.

The allowed-origin regex used to be ``https://.*\\.pages\\.dev|https://.*\\.workers\\.dev``,
which admitted *every* origin on two shared hosting platforms. Since anyone can
deploy to pages.dev, and the middleware is configured with
``allow_credentials=True``, that let an attacker-controlled page make
authenticated cross-origin calls against the admin surface.

These tests pin the narrowed policy in both directions: this project's own Pages
hostnames are still allowed (production and per-branch previews), and the
platform wildcards are not. The suffix cases matter specifically because they
only fail closed if Starlette matches the regex with ``fullmatch`` rather than
``match`` — that behaviour is load-bearing here, so it is asserted rather than
assumed.
"""

import importlib
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_main(monkeypatch, *, pages_project: str | None = None, production: bool = False):
    """Reload main so the module-level CORS regex is rebuilt from env."""
    monkeypatch.delenv("SKIP_AUTH", raising=False)
    monkeypatch.delenv("API_DOCS_ENABLED", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("ENV", raising=False)
    if production:
        monkeypatch.setenv("K_SERVICE", "races-api-dev")
    else:
        monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.delenv("GCS_BUCKET_NAME", raising=False)
    if pages_project is None:
        monkeypatch.delenv("CLOUDFLARE_PAGES_PROJECT", raising=False)
    else:
        monkeypatch.setenv("CLOUDFLARE_PAGES_PROJECT", pages_project)

    import main as main_mod

    return importlib.reload(main_mod)


def _preflight_allowed(client: TestClient, origin: str) -> bool:
    """True if the middleware echoes an allow-origin header for *origin*.

    Uses a preflight because it is answered by the CORS middleware alone, so the
    result reflects the origin policy and nothing about auth or routing.
    """
    response = client.options(
        "/races",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    return "access-control-allow-origin" in {key.lower() for key in response.headers}


@pytest.fixture(autouse=True)
def _restore_dev_main():
    """Leave ``main`` configured as non-production for later test modules."""
    yield
    saved = {name: os.environ.pop(name, None) for name in ("K_SERVICE", "API_DOCS_ENABLED", "ENVIRONMENT", "ENV")}
    try:
        import main as main_mod

        importlib.reload(main_mod)
    finally:
        for name, value in saved.items():
            if value is not None:
                os.environ[name] = value


@pytest.fixture
def client(monkeypatch):
    main_mod = _load_main(monkeypatch)
    with TestClient(main_mod.app) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "origin",
    [
        "https://smarter.vote",
        "https://www.smarter.vote",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        # NOTE: the `http://sveltekit-prerender` build origin is deliberately not
        # asserted here. It is owned by the rate-limiter exemption work, which is
        # removing/replacing it; pinning it in this file would freeze a decision
        # that belongs to that change.
        # Cloudflare Pages production alias for this project.
        "https://smartervote-web.pages.dev",
        # Per-branch and per-deploy preview aliases.
        "https://main.smartervote-web.pages.dev",
        "https://feat-forecast-ui.smartervote-web.pages.dev",
        "https://a1b2c3d4.smartervote-web.pages.dev",
    ],
)
def test_allows_first_party_origins(client, origin):
    assert _preflight_allowed(client, origin), f"expected {origin} to be allowed"


@pytest.mark.parametrize(
    "origin",
    [
        # Any other tenant on the shared Pages platform — the old wildcard's hole.
        "https://attacker.pages.dev",
        "https://smartervote-web-evil.pages.dev",
        "https://totally-unrelated.pages.dev",
        # workers.dev was allowed wholesale and is used by nothing in this repo.
        "https://attacker.workers.dev",
        "https://smartervote-web.workers.dev",
        # Suffix smuggling: only rejected because Starlette uses fullmatch.
        "https://smartervote-web.pages.dev.evil.com",
        "https://evil.com/smartervote-web.pages.dev",
        # Lookalike registrable domains.
        "https://smarter.vote.evil.com",
        "https://smartervote-web.pages.dev.co",
        "http://smartervote-web.pages.dev",  # scheme must be https
    ],
)
def test_rejects_third_party_and_lookalike_origins(client, origin):
    assert not _preflight_allowed(client, origin), f"expected {origin} to be rejected"


def test_pages_project_name_is_configurable(monkeypatch):
    """Renaming the Cloudflare Pages project must not require a code change."""
    main_mod = _load_main(monkeypatch, pages_project="smartervote-staging")
    with TestClient(main_mod.app) as client:
        assert _preflight_allowed(client, "https://smartervote-staging.pages.dev")
        assert _preflight_allowed(client, "https://pr-42.smartervote-staging.pages.dev")
        # The previous default must stop being trusted once the project is renamed.
        assert not _preflight_allowed(client, "https://smartervote-web.pages.dev")


def test_pages_project_name_is_regex_escaped(monkeypatch):
    """A project name is interpolated into a regex; it must not act as one."""
    main_mod = _load_main(monkeypatch, pages_project="a.b")
    with TestClient(main_mod.app) as client:
        assert _preflight_allowed(client, "https://a.b.pages.dev")
        # An unescaped '.' would make this match as a single-character wildcard.
        assert not _preflight_allowed(client, "https://axb.pages.dev")


def test_blank_pages_project_falls_back_to_default(monkeypatch):
    """An empty env override must not collapse the regex into something permissive."""
    main_mod = _load_main(monkeypatch, pages_project="   ")
    with TestClient(main_mod.app) as client:
        assert _preflight_allowed(client, "https://smartervote-web.pages.dev")
        assert not _preflight_allowed(client, "https://attacker.pages.dev")


LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]


@pytest.mark.parametrize("origin", LOCAL_ORIGINS)
def test_production_rejects_local_dev_origins(monkeypatch, origin):
    main_mod = _load_main(monkeypatch, production=True)
    with TestClient(main_mod.app) as client:
        assert not _preflight_allowed(client, origin)
        assert _preflight_allowed(client, "https://smarter.vote")
        assert _preflight_allowed(client, "https://main.smartervote-web.pages.dev")


def test_explicit_production_environment_counts_as_production(monkeypatch):
    main_mod = _load_main(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    main_mod = importlib.reload(main_mod)
    assert main_mod.IS_PRODUCTION is True
    assert main_mod.API_DOCS_ENABLED is False


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_production_hides_api_docs(monkeypatch, path):
    main_mod = _load_main(monkeypatch, production=True)
    with TestClient(main_mod.app) as client:
        assert client.get(path).status_code == 404


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_dev_keeps_api_docs(monkeypatch, path):
    main_mod = _load_main(monkeypatch)
    with TestClient(main_mod.app) as client:
        assert client.get(path).status_code == 200


def test_production_docs_can_be_reenabled_explicitly(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "races-api-dev")
    monkeypatch.delenv("SKIP_AUTH", raising=False)
    monkeypatch.setenv("API_DOCS_ENABLED", "true")
    import main as main_mod

    main_mod = importlib.reload(main_mod)
    with TestClient(main_mod.app) as client:
        assert client.get("/openapi.json").status_code == 200
