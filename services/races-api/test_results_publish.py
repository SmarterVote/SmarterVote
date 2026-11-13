"""Results-only publishing must never carry anything else off a draft."""

from unittest.mock import patch

import gcs_helpers
import pytest

SOURCES = [
    {"url": "https://www.cleveland.com/results", "type": "news"},
    {"url": "https://www.dispatch.com/results", "type": "news"},
]
RESULT = {
    "status": "called",
    "winner_name": "Ann Lee",
    "called_by": "AP",
    "called_at": "2026-11-04T03:00:00Z",
    "candidates": [{"name": "Ann Lee", "pct": 52.0}],
    "sources": SOURCES,
    "as_of": "2026-11-04T03:05:00Z",
}
ROSTER = [{"name": "Ann Lee"}, {"name": "Bob Ray"}]


def _race(**overrides):
    return {"id": "oh-governor-2026", "state": "Ohio", "election_date": "2026-11-03", "candidates": ROSTER, **overrides}


def _publish(draft, published):
    stores = {"drafts": draft, "races": published}
    written = {}

    def put(_race_id, prefix, data):
        written[prefix] = data
        return True

    with (
        patch.object(gcs_helpers, "_gcs_get_race_json", side_effect=lambda _id, prefix: stores[prefix]),
        patch.object(gcs_helpers, "_gcs_put_race_json", side_effect=put),
        patch("gcs_helpers.validate_race_result", return_value=[]),
    ):
        gcs_helpers.publish_race_result("oh-governor-2026")
    return written


def test_only_the_result_leaves_the_draft():
    draft = _race(result=RESULT, candidates=[{"name": "Ann Lee"}], description="unreviewed draft prose")
    published = _race(description="reviewed prose", updated_utc="2026-10-30T00:00:00Z")
    written = _publish(draft, published)
    assert list(written) == ["races"]
    assert written["races"]["result"] == RESULT
    assert written["races"]["description"] == "reviewed prose"
    assert written["races"]["candidates"] == ROSTER
    assert written["races"]["updated_utc"] == "2026-10-30T00:00:00Z"


def test_a_result_failing_the_checks_is_not_written():
    stores = {"drafts": _race(result={**RESULT, "winner_name": "Cal Poe"}), "races": _race()}
    with (
        patch.object(gcs_helpers, "_gcs_get_race_json", side_effect=lambda _id, prefix: stores[prefix]),
        patch.object(gcs_helpers, "_gcs_put_race_json") as put,
        pytest.raises(ValueError),
    ):
        gcs_helpers.publish_race_result("oh-governor-2026")
    put.assert_not_called()


def test_a_draft_without_a_result_is_refused():
    with (
        patch.object(gcs_helpers, "_gcs_get_race_json", return_value=_race()),
        pytest.raises(ValueError, match="no result"),
    ):
        gcs_helpers.publish_race_result("oh-governor-2026")


@pytest.mark.parametrize("draft_result", [None, {**RESULT, "as_of": "2026-11-04T01:00:00Z"}])
def test_a_normal_publish_cannot_erase_or_rewind_the_live_result(draft_result):
    data = _race(result=draft_result)
    with patch.object(gcs_helpers, "_gcs_get_race_json", return_value=_race(result=RESULT)):
        gcs_helpers._carry_forward_published_result("oh-governor-2026", data)
    assert data["result"] == RESULT


def test_a_newer_draft_result_survives_a_normal_publish():
    newer = {**RESULT, "as_of": "2026-11-05T01:00:00Z"}
    data = _race(result=newer)
    with patch.object(gcs_helpers, "_gcs_get_race_json", return_value=_race(result=RESULT)):
        gcs_helpers._carry_forward_published_result("oh-governor-2026", data)
    assert data["result"] == newer


def _live_client(summaries):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers import results

    class _Summaries:
        calls = 0

        def get_race_summaries(self):
            self.calls += 1
            return summaries

    app = FastAPI()
    app.include_router(results.router)
    app.state.publish_service = _Summaries()
    results._clear_results_cache()
    return TestClient(app), results, app.state.publish_service


def test_public_forecast_live_locks_in_called_races_and_is_cacheable():
    race = {
        "id": "oh-governor-2026",
        "office": "Governor",
        "state": "Ohio",
        "candidates": [{"name": "Ann Lee", "party": "Democratic"}, {"name": "Bob Ray", "party": "Republican"}],
        "forecast": {"party_probabilities": {"Democratic": 0.4, "Republican": 0.6}, "rating": "lean_r"},
    }
    index = {
        "generated_at": "2026-11-04T03:06:00Z",
        "races": [{**RESULT, "id": "oh-governor-2026", "winner_party": "Democratic"}],
    }
    client, results, service = _live_client([race])
    try:
        with patch.object(gcs_helpers, "load_results_index", return_value=index) as load:
            response = client.get("/public/forecast-live")
            assert client.get("/public/forecast-live").json() == response.json()
        assert response.status_code == 200
        assert response.headers["cache-control"] == results._RESULTS_CACHE_CONTROL
        governors = response.json()["chambers"]["governors"]
        assert (governors["called_count"], governors["total_count"]) == (1, 1)
        assert governors["as_of"] == RESULT["as_of"]
        assert response.json()["results_updated_at"] == "2026-11-04T03:06:00Z"
        # The second request was served from the 30s local cache.
        assert load.call_count == 1 and service.calls == 1

        # Publishing results clears the projection along with the results file.
        results._clear_results_cache()
        with patch.object(gcs_helpers, "load_results_index", return_value={"generated_at": None, "races": []}):
            governors = client.get("/public/forecast-live").json()["chambers"]["governors"]
        assert governors["called_count"] == 0
    finally:
        results._clear_results_cache()
