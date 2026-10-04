"""Auth0 JWT verification dependency for the races-api admin endpoints."""

import asyncio
import logging
import os
import secrets
import threading
import time
from typing import Any, Optional

import httpx
import jwt
from config import is_production
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError

_http_bearer = HTTPBearer(auto_error=False)

# In-memory cache for Auth0 JWKS to prevent network overhead on every request
_jwks_cache: dict[str, tuple[dict, float]] = {}
_jwks_lock = asyncio.Lock()
_JWKS_CACHE_TTL = 3600.0  # Cache for 1 hour
# An unknown ``kid`` forces a JWKS refetch (key rotation), but the header is
# attacker-controlled: without a throttle every unauthenticated request with a
# random kid became one outbound fetch. Forced refreshes are limited to one per
# interval per domain, and kids still unknown after a refresh are remembered.
_JWKS_FORCED_REFRESH_INTERVAL = 60.0
_UNKNOWN_KID_TTL = 300.0
_UNKNOWN_KID_CACHE_MAX = 1024
_jwks_last_forced_refresh: dict[str, float] = {}
_unknown_kids: dict[tuple[str, str], float] = {}

logger = logging.getLogger("races_api")


async def _get_jwks(auth0_domain: str, *, force_refresh: bool = False) -> dict:
    now = time.monotonic()
    cache_entry = _jwks_cache.get(auth0_domain)
    if force_refresh or cache_entry is None or (now - cache_entry[1]) > _JWKS_CACHE_TTL:
        async with _jwks_lock:
            # Recheck cache after acquiring lock
            now = time.monotonic()
            cache_entry = _jwks_cache.get(auth0_domain)
            if force_refresh and cache_entry is not None:
                last_forced = _jwks_last_forced_refresh.get(auth0_domain)
                if last_forced is not None and now - last_forced < _JWKS_FORCED_REFRESH_INTERVAL:
                    force_refresh = False
                else:
                    _jwks_last_forced_refresh[auth0_domain] = now
            if force_refresh or cache_entry is None or (now - cache_entry[1]) > _JWKS_CACHE_TTL:
                jwks_url = f"https://{auth0_domain}/.well-known/jwks.json"
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(jwks_url)
                    resp.raise_for_status()
                    cache_entry = (resp.json(), now)
                    _jwks_cache[auth0_domain] = cache_entry
    return cache_entry[0]


def _find_key(jwks: dict, kid: object) -> Optional[dict]:
    return next((k for k in jwks["keys"] if k.get("kid") == kid), None)


def _kid_recently_unknown(auth0_domain: str, kid: str) -> bool:
    seen_at = _unknown_kids.get((auth0_domain, kid))
    if seen_at is None:
        return False
    if time.monotonic() - seen_at > _UNKNOWN_KID_TTL:
        _unknown_kids.pop((auth0_domain, kid), None)
        return False
    return True


def _remember_unknown_kid(auth0_domain: str, kid: str) -> None:
    if len(_unknown_kids) >= _UNKNOWN_KID_CACHE_MAX:
        _unknown_kids.clear()
    _unknown_kids[(auth0_domain, kid)] = time.monotonic()


async def _decode_jwt(token: str) -> dict:
    auth0_domain = os.getenv("AUTH0_DOMAIN", "")
    auth0_audience = os.getenv("AUTH0_AUDIENCE", "")
    jwks = await _get_jwks(auth0_domain)

    unverified = jwt.get_unverified_header(token)
    kid = unverified.get("kid")
    rsa_key = _find_key(jwks, kid)
    if not rsa_key and isinstance(kid, str) and not _kid_recently_unknown(auth0_domain, kid):
        # Auth0 may rotate signing keys before the TTL expires. Refresh (at most
        # once per throttle interval) on an unknown key ID so valid tokens do
        # not fail for the cache lifetime.
        refreshed = await _get_jwks(auth0_domain, force_refresh=True)
        rsa_key = _find_key(refreshed, kid)
        # Only a kid absent from a genuinely refetched set is negatively cached;
        # a throttled (cached) answer says nothing about a newly rotated key.
        if not rsa_key and refreshed is not jwks:
            _remember_unknown_kid(auth0_domain, kid)
    if not rsa_key:
        raise HTTPException(status_code=401, detail="Invalid token: signing key not found")
    return jwt.decode(
        token,
        jwt.PyJWK.from_dict(rsa_key).key,
        algorithms=["RS256"],
        audience=auth0_audience,
        issuer=f"https://{auth0_domain}/",
    )


async def verify_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_http_bearer),
    x_admin_key: str = Header(default=""),
) -> dict:
    """Dependency: verify Auth0 JWT bearer token or admin API key.

    Set SKIP_AUTH=true (or 1 or yes) to bypass verification in local dev.
    Set ADMIN_API_KEY to allow non-browser admin clients with X-Admin-Key.
    """
    # Read env at call time so tests can set it without module reload.
    skip_auth = os.getenv("SKIP_AUTH", "").lower() in ("1", "true", "yes")
    if skip_auth:
        if not is_production():
            return {}
        # A stray SKIP_AUTH on the deployed service would make every admin
        # endpoint anonymous; refuse it there and authenticate normally.
        logger.error("SKIP_AUTH is set on a production service and is being ignored")

    if not isinstance(x_admin_key, str):
        x_admin_key = ""
    admin_api_key = os.getenv("ADMIN_API_KEY", "")
    if admin_api_key and x_admin_key:
        if secrets.compare_digest(x_admin_key, admin_api_key):
            return {"auth": "admin_api_key"}
        if credentials is None:
            raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")

    auth0_domain = os.getenv("AUTH0_DOMAIN", "")
    auth0_audience = os.getenv("AUTH0_AUDIENCE", "")
    if not auth0_domain or not auth0_audience:
        raise HTTPException(
            status_code=503,
            detail="Auth not configured (AUTH0_DOMAIN/AUTH0_AUDIENCE missing). Set SKIP_AUTH=true for local dev.",
        )
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return await _decode_jwt(credentials.credentials)
    except (InvalidTokenError, httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication") from exc


# ---------------------------------------------------------------------------
# Cloud Scheduler OIDC (narrow: GET /api/queue only)
# ---------------------------------------------------------------------------
# The queue-backlog Cloud Scheduler job (infra/monitoring.tf) authenticates
# with a Google-signed OIDC ID token for a dedicated service account instead
# of a plaintext X-Admin-Key header. That identity is trusted ONLY on routes
# that opt in with ``verify_token_or_scheduler``; every other admin route keeps
# ``verify_token`` and rejects these tokens (they are not Auth0 tokens).

_GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
# Google's signing certs rotate on a schedule of days and are published well
# before use, so a short response cache is safe. It keeps a stream of forged
# "Google-looking" bearer tokens from turning into one outbound fetch each.
_GOOGLE_CERTS_CACHE_TTL = 600.0
_google_certs_cache: dict[str, tuple[Any, float]] = {}
_google_certs_lock = threading.Lock()


class _CachingGoogleRequest:
    """google.auth transport wrapper that caches GET responses (the certs) briefly."""

    def __init__(self) -> None:
        import google.auth.transport.requests

        self._inner = google.auth.transport.requests.Request()

    def __call__(self, url: str, method: str = "GET", **kwargs: Any) -> Any:
        if method != "GET":
            return self._inner(url, method=method, **kwargs)
        now = time.monotonic()
        with _google_certs_lock:
            cached = _google_certs_cache.get(url)
            if cached is not None and now - cached[1] < _GOOGLE_CERTS_CACHE_TTL:
                return cached[0]
        response = self._inner(url, method=method, **kwargs)
        if getattr(response, "status", None) == 200:
            with _google_certs_lock:
                _google_certs_cache[url] = (response, now)
        return response


def _verify_google_id_token(token: str, audience: str) -> dict:
    """Verify a Google-signed ID token's signature, expiry, issuer, and audience.

    Raises ValueError (or a google.auth exception) on any failure.
    """
    from google.oauth2 import id_token as google_id_token

    return google_id_token.verify_oauth2_token(token, _CachingGoogleRequest(), audience=audience)


def _looks_like_google_token(token: str) -> bool:
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except InvalidTokenError:
        return False
    return claims.get("iss") in _GOOGLE_ISSUERS


async def verify_token_or_scheduler(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_http_bearer),
    x_admin_key: str = Header(default=""),
) -> dict:
    """Dependency: ``verify_token``, or the Cloud Scheduler service account's OIDC token.

    Only for read-only routes the scheduler polls. The OIDC path is enabled only
    when both SCHEDULER_INVOKER_EMAIL and SCHEDULER_OIDC_AUDIENCE are set, and a
    Google-issued bearer token must pass signature, audience, ``email`` ==
    SCHEDULER_INVOKER_EMAIL, and ``email_verified`` checks. Anything else falls
    through to ``verify_token`` unchanged.
    """
    expected_email = os.getenv("SCHEDULER_INVOKER_EMAIL", "").strip()
    expected_audience = os.getenv("SCHEDULER_OIDC_AUDIENCE", "").strip()
    if expected_email and expected_audience and credentials is not None and _looks_like_google_token(credentials.credentials):
        try:
            claims = await asyncio.to_thread(_verify_google_id_token, credentials.credentials, expected_audience)
        except Exception as exc:  # signature/expiry/audience/issuer/cert fetch failure
            logger.warning("Rejected Google OIDC token: %s", type(exc).__name__)
            raise HTTPException(status_code=401, detail="Invalid authentication") from exc
        email = claims.get("email")
        if (
            claims.get("iss") not in _GOOGLE_ISSUERS
            or not isinstance(email, str)
            or not secrets.compare_digest(email.lower(), expected_email.lower())
            or claims.get("email_verified") is not True
        ):
            raise HTTPException(status_code=401, detail="Invalid authentication")
        return {"auth": "scheduler_oidc", "email": email}
    return await verify_token(credentials=credentials, x_admin_key=x_admin_key)
