"""Setting a draft result by hand: the race checks still apply, only the read check does not."""

from unittest.mock import patch

import gcs_helpers
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROSTER = [{"name": "Ann Lee", "party": "Democratic"}, {"name": "Bob Ray", "party": "Republican"}]
PUBLISHED = {
    "id": "oh-governor-2026",
    "state": "Ohio",
    "election_date": "2026-11-03",
    "candidates": ROSTER,
    "description": "reviewed prose",
    "result": {
        "status": "counting",
        "candidates": [{"name": "Ann Lee", "pct": 48.0}, {"name": "Bob Ray", "pct": 52.0}],
        "sources": [{"url": "https://www.cleveland.com/results", "type": "news"}],
        "as_of": "2026-11-04T03:05:00Z",
    },
}
CALL = {
    "status": "called",
    "winner_name": "Ann Lee",
    "called_by": "Associated Press",
    "called_at": "2026-11-05T19:40:00Z",
    "pct_reporting": 99,
    "candidates": [{"name": "Ann Lee", "pct": 51.0, "votes": 1020}, {"name": "Bob Ray", "pct": 49.0, "votes": 980}],
    "sources": [
        {"url": "https://www.nbcnews.com/politics/2026-elections/ohio-governor-results", "type": "news"},
        {"url": "https://apnews.com/article/ohio-governor", "type": "news"},
    ],
    "correction_note": "The earlier partial count had Bob Ray ahead.",
    "set_by": "command center",
    "note": "Copied from NBC; AP call story.",
}


@pytest.fixture
def stores(monkeypatch):
    monkeypatch.setenv("SKIP_AUTH", "true")
    data = {"races": dict(PUBLISHED), "drafts": None}
    writes = []

    def put(_race_id, prefix, race):
        data[prefix] = race
        writes.append(prefix)
        return True

    with (
        patch.object(gcs_helpers, "_gcs_get_race_json", side_effect=lambda _id, prefix: data[prefix]),
        patch.object(gcs_helpers, "_gcs_put_race_json", side_effect=put),
        patch.object(gcs_helpers, "_gcs_archive_active_if_present", return_value=True),
    ):
        yield data, writes


def _client():
    from routers import results

    app = FastAPI()
    app.include_router(results.router)
    return TestClient(app)


def test_a_sourced_call_lands_on_the_draft_with_an_audit_note(stores):
    data, writes = stores
    response = _client().put("/api/races/oh-governor-2026/result", json=CALL)
    assert response.status_code == 200, response.text
    assert writes == ["drafts"]  # never the published race
    result = data["drafts"]["result"]
    assert result["winner_party"] == "Democratic"
    assert [row["party"] for row in result["candidates"]] == ["Democratic", "Republican"]
    assert result["audit"]["method"] == "admin_set_result"
    assert result["audit"]["set_by"].startswith("command center")
    assert result["audit"]["source_urls"] == [source["url"] for source in CALL["sources"]]
    assert result["audit"]["note"] == CALL["note"]
    # The draft started from the published race, and publishing copies only the result.
    assert data["drafts"]["description"] == "reviewed prose"
    with patch("gcs_helpers.validate_race_result", wraps=gcs_helpers.validate_race_result):
        published = gcs_helpers.publish_race_result("oh-governor-2026")
    assert published["result"] == result


def test_counts_need_not_appear_in_pages_read_by_a_model(stores):
    # No fresh-read block is open, and the counts appear nowhere: the race checks alone decide.
    response = _client().put("/api/races/oh-governor-2026/result", json={**CALL, "note": None})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    "change, message",
    [
        ({"winner_name": "Cal Poe"}, "not on the race roster"),
        ({"called_at": None}, "needs called_at"),
        ({"sources": [CALL["sources"][0]]}, "two independent domains"),
        ({"candidates": [{"name": "Ann Lee", "pct": 51.0}]}, "dropping"),
    ],
)
def test_the_race_checks_still_reject(stores, change, message):
    _data, writes = stores
    response = _client().put("/api/races/oh-governor-2026/result", json={**CALL, **change})
    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert writes == []


def test_changing_a_published_winner_still_needs_a_correction_note(stores):
    data, writes = stores
    data["races"] = {**PUBLISHED, "result": {**PUBLISHED["result"], **CALL, "status": "called"}}
    body = {**CALL, "winner_name": "Bob Ray", "correction_note": None}
    response = _client().put("/api/races/oh-governor-2026/result", json=body)
    assert response.status_code == 422
    assert "winner changed without a correction_note" in response.json()["detail"]
    assert writes == []


def test_a_malformed_count_or_an_unpublished_race_is_refused(stores):
    data, writes = stores
    bad = {**CALL, "candidates": [{"name": "Ann Lee", "votes": -5}, {"name": "Bob Ray", "votes": 1}]}
    assert _client().put("/api/races/oh-governor-2026/result", json=bad).status_code == 422
    data["races"] = None
    assert _client().put("/api/races/oh-governor-2026/result", json=CALL).status_code == 404
    assert writes == []
