"""A stale review flag must not block publication (#323, #325).

Reviewer flags address candidates positionally, so once a refresh changes the
roster, `candidates[1].image_url` points at a different person. Such a flag is
kept in the draft for the audit trail but must not veto the publish, or a
refresh that *corrects* a roster can never be published.
"""

import pathlib
import sys
from unittest.mock import patch

import pytest

RACES_API_DIR = pathlib.Path(__file__).parent.parent / "services" / "races-api"
if str(RACES_API_DIR) not in sys.path:
    sys.path.insert(0, str(RACES_API_DIR))

import gcs_helpers  # noqa: E402


def _draft(flag):
    return {
        "id": "ne-senate-2026",
        "candidates": [{"name": "Pete Ricketts"}, {"name": "Dan Osborn"}],
        "pipeline_state": {"complete": True, "remaining_candidates": [], "remaining_steps": []},
        "reviews": [{"model": "claude", "verdict": "flagged", "score": 79, "flags": [flag]}],
    }


def test_live_error_flag_still_blocks_publication():
    draft = _draft({"field": "candidates[1].image_url", "concern": "wrong face", "severity": "error"})
    with pytest.raises(ValueError, match="unresolved error-severity"):
        gcs_helpers._assert_publishable_race(draft)


def test_stale_error_flag_does_not_block_publication():
    draft = _draft({"field": "candidates[1].image_url", "concern": "wrong face", "severity": "error", "stale": True})
    gcs_helpers._assert_publishable_race(draft)


def test_stale_flag_does_not_excuse_a_live_one_on_the_same_draft():
    draft = _draft({"field": "candidates[1].image_url", "concern": "wrong face", "severity": "error", "stale": True})
    draft["reviews"][0]["flags"].append({"field": "title", "concern": "wrong office", "severity": "error"})
    with pytest.raises(ValueError, match="unresolved error-severity"):
        gcs_helpers._assert_publishable_race(draft)


def test_grade_from_only_stale_reviews_blocks_publication_even_if_marked_passed():
    """A stored grade computed solely from reviews of a superseded roster is not a pass."""
    draft = _draft({"field": "title", "concern": "minor", "severity": "warning"})
    draft["reviews"][0]["stale"] = True
    draft["validation_grade"] = {
        "grade": "A",
        "score": 95,
        "passed": True,
        "summary": "Reviews are out of date",
        "current_review_count": 0,
        "stale_review_count": 1,
    }
    with pytest.raises(ValueError, match="out of date"):
        gcs_helpers._assert_publishable_race(draft)


def test_grade_with_a_current_review_still_publishes():
    draft = _draft({"field": "title", "concern": "minor", "severity": "warning"})
    draft["validation_grade"] = {
        "grade": "A",
        "score": 95,
        "passed": True,
        "summary": "Validated",
        "current_review_count": 1,
        "stale_review_count": 2,
    }
    gcs_helpers._assert_publishable_race(draft)
