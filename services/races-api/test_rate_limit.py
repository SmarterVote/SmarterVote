from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from rate_limit import FirestoreRateLimitStorage, get_rate_limit_key
from starlette.requests import Request


def _request(origin: str | None = None) -> Request:
    headers = [] if origin is None else [(b"origin", origin.encode())]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": ("203.0.113.5", 1)})


def test_rate_limit_key_ignores_spoofed_prerender_origin():
    assert get_rate_limit_key(_request("http://sveltekit-prerender")) == "203.0.113.5"


def test_firestore_storage_increments_existing_window():
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    snapshot = MagicMock(exists=True)
    snapshot.to_dict.return_value = {"count": 4, "expires_at": expires_at}
    doc_ref = MagicMock()
    doc_ref.get.return_value = snapshot
    collection = MagicMock()
    collection.document.return_value = doc_ref
    db = MagicMock()
    db.collection.return_value = collection
    transaction = MagicMock()
    db.transaction.return_value = transaction
    storage = FirestoreRateLimitStorage("firestore://")
    storage._db = db

    with patch("google.cloud.firestore.transactional", side_effect=lambda fn: fn):
        assert storage.incr("client:/races", 60) == 5

    transaction.set.assert_called_once()
    payload = transaction.set.call_args.args[1]
    assert payload["count"] == 5
    assert payload["expires_at"] == expires_at


def test_firestore_storage_resets_expired_window():
    snapshot = MagicMock(exists=True)
    snapshot.to_dict.return_value = {
        "count": 9,
        "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
    }
    doc_ref = MagicMock()
    doc_ref.get.return_value = snapshot
    collection = MagicMock()
    collection.document.return_value = doc_ref
    db = MagicMock()
    db.collection.return_value = collection
    transaction = MagicMock()
    db.transaction.return_value = transaction
    storage = FirestoreRateLimitStorage("firestore://")
    storage._db = db

    with patch("google.cloud.firestore.transactional", side_effect=lambda fn: fn):
        assert storage.incr("client:/races", 60) == 1

    assert transaction.set.call_args.args[1]["count"] == 1


def test_firestore_storage_read_health_and_cleanup_operations():
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    snapshot = MagicMock(exists=True)
    snapshot.to_dict.return_value = {"count": 3, "expires_at": expires_at}
    doc_ref = MagicMock()
    doc_ref.get.return_value = snapshot
    collection = MagicMock()
    collection.document.return_value = doc_ref
    collection.limit.return_value = collection
    cleanup_doc = MagicMock()
    collection.stream.return_value = iter([cleanup_doc])
    db = MagicMock()
    db.collection.return_value = collection
    storage = FirestoreRateLimitStorage("firestore://")
    storage._db = db

    assert storage.get("client:/races") == 3
    assert storage.get_expiry("client:/races") == expires_at.timestamp()
    assert storage.check() is True
    collection.stream.return_value = iter([cleanup_doc])
    assert storage.reset() == 1
    cleanup_doc.reference.delete.assert_called_once_with()
    storage.clear("client:/races")
    doc_ref.delete.assert_called_once_with()


def _xff_request(xff: str | None, peer: str = "169.254.1.1") -> Request:
    headers = [] if xff is None else [(b"x-forwarded-for", xff.encode())]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 1)})


def test_rate_limit_key_uses_right_most_forwarded_hop(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    # Cloud Run's front end appends the real client after whatever the caller sent.
    assert get_rate_limit_key(_xff_request("1.2.3.4, 198.51.100.7")) == "198.51.100.7"
    assert get_rate_limit_key(_xff_request("198.51.100.7")) == "198.51.100.7"


def test_rate_limit_key_cannot_be_spoofed_by_rotating_left_most_value(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    keys = {get_rate_limit_key(_xff_request(f"10.0.0.{n}, 198.51.100.7")) for n in range(5)}
    assert keys == {"198.51.100.7"}


def test_rate_limit_key_honours_extra_trusted_hops(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert get_rate_limit_key(_xff_request("1.2.3.4, 198.51.100.7, 35.191.0.1")) == "198.51.100.7"


def test_rate_limit_key_falls_back_to_peer_without_or_with_bad_header(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    assert get_rate_limit_key(_xff_request(None)) == "169.254.1.1"
    assert get_rate_limit_key(_xff_request("not-an-ip")) == "169.254.1.1"
    assert get_rate_limit_key(_xff_request("")) == "169.254.1.1"


def test_analytics_middleware_uses_same_client_ip_rule(monkeypatch):
    import analytics_middleware
    from rate_limit import client_ip

    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    assert analytics_middleware.client_ip.__module__ == client_ip.__module__ == "rate_limit"
    assert client_ip(_xff_request("6.6.6.6, 198.51.100.7")) == "198.51.100.7"
    assert "/geocode" in analytics_middleware._SKIP_PREFIXES
