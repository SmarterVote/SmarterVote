"""Shared API rate limiter configuration.

Production uses Firestore so limits apply across Cloud Run instances. Local
development and tests retain the limits library's in-memory backend.
"""

import hashlib
import ipaddress
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request
from limits.storage import Storage
from slowapi import Limiter
from slowapi.util import get_remote_address

from shared.config import FIRESTORE_RATE_LIMITS_COLLECTION


class FirestoreRateLimitStorage(Storage):
    """Minimal fixed-window storage backend for the ``limits`` package."""

    STORAGE_SCHEME = ["firestore"]

    def __init__(self, uri: str | None = None, **options: Any) -> None:
        super().__init__(uri, **options)
        self._db: Any = None

    @property
    def base_exceptions(self) -> type[Exception]:
        return Exception

    def _client(self) -> Any:
        if self._db is None:
            from google.cloud import firestore

            project = os.getenv("FIRESTORE_PROJECT") or os.getenv("GCP_PROJECT_ID") or None
            self._db = firestore.Client(project=project)
        return self._db

    def _document(self, key: str) -> Any:
        document_id = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self._client().collection(FIRESTORE_RATE_LIMITS_COLLECTION).document(document_id)

    @staticmethod
    def _expiry(snapshot: Any) -> datetime | None:
        value = (snapshot.to_dict() or {}).get("expires_at") if getattr(snapshot, "exists", False) else None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return None

    def incr(self, key: str, expiry: int, amount: int = 1) -> int:
        from google.cloud import firestore

        doc_ref = self._document(key)
        transaction = self._client().transaction()

        @firestore.transactional
        def _increment(txn: Any) -> int:
            snapshot = doc_ref.get(transaction=txn)
            now = datetime.now(timezone.utc)
            expires_at = self._expiry(snapshot)
            if expires_at is None or expires_at <= now:
                count = amount
                expires_at = now + timedelta(seconds=expiry)
            else:
                count = int((snapshot.to_dict() or {}).get("count", 0)) + amount
            txn.set(doc_ref, {"count": count, "expires_at": expires_at, "updated_at": now})
            return count

        return _increment(transaction)

    def get(self, key: str) -> int:
        snapshot = self._document(key).get()
        expiry = self._expiry(snapshot)
        if expiry is None or expiry <= datetime.now(timezone.utc):
            return 0
        return int((snapshot.to_dict() or {}).get("count", 0))

    def get_expiry(self, key: str) -> float:
        expiry = self._expiry(self._document(key).get())
        return expiry.timestamp() if expiry else time.time()

    def check(self) -> bool:
        list(self._client().collection(FIRESTORE_RATE_LIMITS_COLLECTION).limit(1).stream())
        return True

    def reset(self) -> int:
        docs = list(self._client().collection(FIRESTORE_RATE_LIMITS_COLLECTION).stream())
        for doc in docs:
            doc.reference.delete()
        return len(docs)

    def clear(self, key: str) -> None:
        self._document(key).delete()


def _trusted_proxy_hops() -> int:
    """How many trusted proxies append to X-Forwarded-For (Cloud Run direct: 1)."""
    try:
        return max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
    except ValueError:
        return 1


def _valid_ip(value: str) -> str | None:
    candidate = value.strip()
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return None
    return candidate


def client_ip(request: Request) -> str | None:
    """Return the caller's IP as observed by the trusted front end.

    On Cloud Run, Google's front end *appends* the address of the connecting
    client to whatever X-Forwarded-For the caller sent, so the right-most entry
    is the only one a client cannot forge (``TRUSTED_PROXY_HOPS`` counts extra
    trusted proxies such as a load balancer, each of which appends one more
    hop). The left-most entry is caller-controlled and must never be used as a
    rate-limit or analytics key. Without the header (local dev, tests) fall back
    to the socket peer.
    """
    hops = _trusted_proxy_hops()
    xff = request.headers.get("x-forwarded-for")
    if hops and xff:
        entries = [entry.strip() for entry in xff.split(",") if entry.strip()]
        if len(entries) >= hops:
            ip = _valid_ip(entries[-hops])
            if ip:
                return ip
    return request.client.host if request.client else None


def get_rate_limit_key(request: Request) -> str:
    """Return a client key; no caller-controlled header can disable limits."""
    return client_ip(request) or get_remote_address(request)


limiter = Limiter(
    key_func=get_rate_limit_key,
    storage_uri=os.getenv("RATE_LIMIT_STORAGE_URI", "memory://"),
    # Emit X-RateLimit-Limit / -Remaining / -Reset (and Retry-After on 429).
    # Every @limiter.limit endpoint must take a ``response: Response`` argument
    # (or return a Response) for slowapi to attach these.
    headers_enabled=True,
)
