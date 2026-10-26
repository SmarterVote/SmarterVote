"""Tests for the free-text ineligible-incumbent roster filter in discovery."""

from pipeline_client.agent.phases.discovery import _remove_ineligible_officeholders


def _names(race_json):
    return [candidate["name"] for candidate in race_json["candidates"]]


def test_predecessor_term_limited_sentence_keeps_incumbent():
    race_json = {
        "candidates": [
            {
                "name": "Jane Doe",
                "incumbent": True,
                "summary": "Doe is seeking a third term. Her predecessor was term-limited.",
            }
        ]
    }

    _remove_ineligible_officeholders(race_json)

    assert _names(race_json) == ["Jane Doe"]


def test_whose_predecessor_clause_keeps_incumbent():
    race_json = {
        "candidates": [
            {
                "name": "Jane Doe",
                "incumbent": True,
                "summary": "Doe, whose predecessor was term-limited, is seeking a third term.",
            }
        ]
    }

    _remove_ineligible_officeholders(race_json)

    assert _names(race_json) == ["Jane Doe"]


def test_source_title_about_another_officeholder_keeps_candidate():
    race_json = {
        "candidates": [
            {
                "name": "Yolanda Young",
                "incumbent": True,
                "summary": "Rep. Yolanda Young is running for governor.",
                "summary_sources": [
                    {"url": "https://news.example.com/a", "title": "Gov. Xavier Cole not running; Rep. Young jumps in"}
                ],
            }
        ]
    }

    _remove_ineligible_officeholders(race_json)

    assert _names(race_json) == ["Yolanda Young"]


def test_other_named_subject_between_candidate_and_phrase_keeps_candidate():
    race_json = {
        "candidates": [
            {
                "name": "Yolanda Young",
                "incumbent": True,
                "summary": "Young jumped in after Gov. Cole said he is not running.",
            }
        ]
    }

    _remove_ineligible_officeholders(race_json)

    assert _names(race_json) == ["Yolanda Young"]


def test_candidate_named_as_subject_of_term_limit_is_removed():
    race_json = {
        "candidates": [
            {
                "name": "Brian Kemp",
                "incumbent": True,
                "summary": "Brian Kemp is term-limited from running again in 2026.",
            },
            {
                "name": "Xavier Cole",
                "incumbent": True,
                "summary": "Cole has served two terms.",
                "summary_sources": [
                    {"url": "https://news.example.com/b", "title": "Gov. Xavier Cole not running for re-election"}
                ],
            },
            {"name": "Chris Carr", "incumbent": False, "summary": "Carr says the incumbent is not running."},
        ]
    }

    _remove_ineligible_officeholders(race_json)

    assert _names(race_json) == ["Chris Carr"]
