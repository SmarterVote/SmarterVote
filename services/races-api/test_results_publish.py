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
