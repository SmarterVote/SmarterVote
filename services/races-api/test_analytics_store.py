import sqlite3
from datetime import datetime, timezone

import analytics_store


def test_sqlite_trim_is_deterministic_and_bounded(monkeypatch, tmp_path):
    monkeypatch.delenv("FIRESTORE_PROJECT", raising=False)
    monkeypatch.setenv("ANALYTICS_DB_PATH", str(tmp_path / "analytics.db"))
    monkeypatch.setattr(analytics_store, "_SQLITE_EVENT_LIMIT", 10)
    monkeypatch.setattr(analytics_store, "_SQLITE_TRIM_INTERVAL", 5)
    store = analytics_store.AnalyticsStore()
    timestamp = datetime.now(timezone.utc).isoformat()

    for index in range(15):
        store._log_sqlite(timestamp, f"/races/test-{index}", None, 200, 10, None, None)

    with sqlite3.connect(store._db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM analytics_events").fetchone()[0]

    assert count == 10


def test_ip_hash_is_keyed_never_plain_sha256(monkeypatch):
    import hashlib

    monkeypatch.setenv("ANALYTICS_IP_HASH_KEY", "key-one")
    first = analytics_store.hash_client_ip("203.0.113.9")
    assert first != hashlib.sha256(b"203.0.113.9").hexdigest()[:16]
    assert len(first) == 16
    # Stable for a configured key (multi-day unique-visitor windows).
    later = datetime(2030, 1, 2, tzinfo=timezone.utc)
    assert analytics_store.hash_client_ip("203.0.113.9", now=later) == first
    monkeypatch.setenv("ANALYTICS_IP_HASH_KEY", "key-two")
    assert analytics_store.hash_client_ip("203.0.113.9") != first
    assert analytics_store.hash_client_ip(None) is None
    assert analytics_store.hash_client_ip("") is None


def test_ip_hash_fallback_rotates_daily_from_server_secret(monkeypatch):
    import hashlib

    monkeypatch.delenv("ANALYTICS_IP_HASH_KEY", raising=False)
    monkeypatch.setenv("ADMIN_API_KEY", "server-secret")
    day1 = datetime(2026, 10, 1, 8, tzinfo=timezone.utc)
    day1_late = datetime(2026, 10, 1, 23, tzinfo=timezone.utc)
    day2 = datetime(2026, 10, 2, 8, tzinfo=timezone.utc)
    h1 = analytics_store.hash_client_ip("203.0.113.9", now=day1)
    assert h1 == analytics_store.hash_client_ip("203.0.113.9", now=day1_late)
    assert h1 != analytics_store.hash_client_ip("203.0.113.9", now=day2)
    assert h1 != hashlib.sha256(b"203.0.113.9").hexdigest()[:16]

    # No server secret at all: still salted with a per-process secret.
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    h_proc = analytics_store.hash_client_ip("203.0.113.9", now=day1)
    assert h_proc not in {h1, hashlib.sha256(b"203.0.113.9").hexdigest()[:16]}
