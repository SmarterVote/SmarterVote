"""Static live feeds: written to the public bucket on publish, stale copy kept on failure."""

import json
from unittest.mock import MagicMock, patch

import gcs_helpers
import live_feeds
import pytest
from routers import results as results_router
from routers.races_admin import helpers

RESULTS = {"generated_at": "2026-11-04T03:00:00Z", "races": [{"id": "oh-governor-2026"}]}
FORECAST = {"schema_version": "forecast_live.v1", "chambers": {}}


def _client():
    client = MagicMock()
    blobs = {}

    def blob(name):
        blobs[name] = MagicMock(name=name)
        return blobs[name]

    client.bucket.return_value.blob.side_effect = blob
    return client, blobs


@pytest.fixture(autouse=True)
def _bucket(monkeypatch):
    monkeypatch.setenv("LIVE_FEEDS_BUCKET", "feeds-bucket")


def test_both_feeds_are_written_with_a_30_second_cache():
    client, blobs = _client()
    with patch.object(gcs_helpers, "_get_gcs_admin", return_value=client):
        outcome = live_feeds.write_live_feeds(RESULTS, FORECAST)
    assert outcome == {"results-live.json": True, "forecast-live.json": True}
    client.bucket.assert_called_with("feeds-bucket")
    for name, payload in (("results-live.json", RESULTS), ("forecast-live.json", FORECAST)):
        assert blobs[name].cache_control == "public, max-age=30"
        args, kwargs = blobs[name].upload_from_string.call_args
        assert json.loads(args[0]) == payload
        assert kwargs["content_type"] == "application/json"


def test_nothing_is_written_without_a_bucket(monkeypatch):
    monkeypatch.delenv("LIVE_FEEDS_BUCKET")
    with patch.object(gcs_helpers, "_get_gcs_admin") as get_client:
        assert live_feeds.write_live_feeds(RESULTS, FORECAST) == {}
    get_client.assert_not_called()


def test_a_failed_write_does_not_raise_or_stop_the_other_feed():
    client, blobs = _client()
    real_blob = client.bucket.return_value.blob.side_effect

    def blob(name):
        b = real_blob(name)
        if name == "results-live.json":
            b.upload_from_string.side_effect = RuntimeError("boom")
        return b

    client.bucket.return_value.blob.side_effect = blob
    with patch.object(gcs_helpers, "_get_gcs_admin", return_value=client):
        outcome = live_feeds.write_live_feeds(RESULTS, FORECAST)
    assert outcome == {"results-live.json": False, "forecast-live.json": True}
    blobs["forecast-live.json"].upload_from_string.assert_called_once()


def test_missing_storage_client_is_a_failed_write_not_an_error():
    with patch.object(gcs_helpers, "_get_gcs_admin", return_value=None):
        assert live_feeds.write_feed("results-live.json", RESULTS) is False


def test_refresh_builds_from_fresh_data_and_writes():
    service = MagicMock()
    service.get_race_summaries_fresh.return_value = [{"id": "x"}]
    with (
        patch.object(results_router.gcs_helpers, "load_results_index", return_value=RESULTS),
        patch.object(results_router, "build_live_chamber_projection", return_value=FORECAST) as build,
        patch.object(live_feeds, "write_live_feeds") as write,
    ):
        results_router.refresh_live_feeds(service)
    build.assert_called_once_with([{"id": "x"}], RESULTS)
    write.assert_called_once_with(RESULTS, FORECAST)


def test_refresh_swallows_errors_so_the_publish_still_succeeds():
    service = MagicMock()
    service.get_race_summaries_fresh.side_effect = RuntimeError("down")
    with patch.object(live_feeds, "write_live_feeds") as write:
        results_router.refresh_live_feeds(service)
    write.assert_not_called()


def test_refresh_is_a_no_op_without_a_bucket(monkeypatch):
    monkeypatch.delenv("LIVE_FEEDS_BUCKET")
    service = MagicMock()
    results_router.refresh_live_feeds(service)
    service.get_race_summaries_fresh.assert_not_called()


def test_clearing_the_public_cache_refreshes_the_feeds():
    request = MagicMock()
    with patch.object(results_router, "refresh_live_feeds") as refresh:
        helpers._clear_public_race_cache(request)
    request.app.state.publish_service.clear_cache.assert_called_once()
    refresh.assert_called_once_with(request.app.state.publish_service)
