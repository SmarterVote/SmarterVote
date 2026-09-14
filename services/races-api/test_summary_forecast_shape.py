"""Every races/summaries.json writer must emit the same forecast shape.

Two of them used to carry their own hand-copied field lists, which silently
dropped takeaway, key_reasons, uncertainty and the forecast panel from the
index the forecast page is built from.
"""

import gcs_helpers
from simple_publish_service import SimplePublishService

from shared.race_catalog import build_forecast_summary

RACE = {
    "id": "nh-senate-2026",
    "title": "2026 New Hampshire U.S. Senate Election",
    "office": "U.S. Senate",
    "state": "New Hampshire",
    "election_date": "2026-11-03",
    "candidates": [{"name": "Chris Pappas", "party": "Democratic"}],
    "forecast": {
        "rating": "lean_d",
        "confidence": "low",
        "win_probability": 0.66,
        "party_probabilities": {"Democratic": 0.66, "Republican": 0.34},
        "rationale": "Pappas leads narrowly.",
        "takeaway": "Democrats are favored.",
        "key_reasons": ["Recent polling"],
        "uncertainty": "Polls disagree.",
        "generated_at": "2026-09-14T12:53:34Z",
        "model": "writer/model",
        "method": "panel_median_v1",
        "panel": [{"model": "a/model", "party_probabilities": {"Democratic": 0.72, "Republican": 0.28}}],
        "panel_spread": 0.17,
    },
}


def test_summary_writers_share_the_catalog_forecast_shape():
    expected = build_forecast_summary(RACE)
    assert gcs_helpers._summary_from_race_data("nh-senate-2026", RACE)["forecast"] == expected
    assert SimplePublishService._summary_from_race_data("nh-senate-2026", RACE)["forecast"] == expected


def test_summary_forecast_keeps_the_fields_the_forecast_page_shows():
    forecast = gcs_helpers._summary_from_race_data("nh-senate-2026", RACE)["forecast"]
    assert forecast["takeaway"] == "Democrats are favored."
    assert forecast["key_reasons"] == ["Recent polling"]
    assert forecast["uncertainty"] == "Polls disagree."
    assert forecast["method"] == "panel_median_v1"
    assert forecast["panel_spread"] == 0.17
    assert len(forecast["panel"]) == 1


def test_summary_without_a_forecast_has_none():
    race = {key: value for key, value in RACE.items() if key != "forecast"}
    assert gcs_helpers._summary_from_race_data("nh-senate-2026", race)["forecast"] is None
