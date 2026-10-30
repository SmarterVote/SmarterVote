"""One survey stored at its field end date and release date under two pollster spellings is one poll.

ia-senate-2026 (draft, after polling) carried each of three surveys twice, the copies
4-8 days apart with the identical topline in a different candidate order.
"""

from __future__ import annotations

import copy

import pytest

from pipeline_client.agent.agent import _sanitize_polling
from pipeline_client.agent.handlers import _make_editing_handlers
from pipeline_client.agent.polling_quality import (
    is_relabeled_same_survey,
    is_same_poll,
    merge_relabeled_survey_polls,
    pollster_identities_compatible,
    restore_dropped_baseline_polls,
)

GSG_LONG = "GS Strategy Group/New River Strategies (for The Cook Political Report)"


def _poll(pollster, day, hinson, turek, sample_size=None, url="https://example.com/poll", turek_first=False):
    names, pcts = ["Ashley Hinson", "Josh Turek"], [hinson, turek]
    if turek_first:
        names, pcts = names[::-1], pcts[::-1]
    poll = {"pollster": pollster, "date": day, "matchups": [{"candidates": names, "percentages": pcts}]}
    if url:
        poll["source_url"] = url
    if sample_size:
        poll["sample_size"] = sample_size
    return poll


def _ia_pairs():
    return [
        (
            _poll("Marist University", "2026-10-11", 45, 48, url="https://www.270towin.com/2026-senate-polls/iowa"),
            _poll("Marist Poll", "2026-10-15", 45, 48, 1100, url="https://maristpoll.marist.edu/iowa-2026", turek_first=True),
        ),
        (
            _poll("NPA Polling", "2026-10-12", 47, 44, 678, url="https://npa.example/ia-oct.pdf"),
            _poll("National Public Affairs", "2026-10-20", 47, 44, 678, url="https://npa.example/ia", turek_first=True),
        ),
        (
            _poll(GSG_LONG, "2026-10-13", 44, 46, 602, url="https://www.cookpolitical.com/ia-senate-poll"),
            _poll("New River / GSG", "2026-10-21", 44, 46, 602, url="https://newriver.example/ia", turek_first=True),
        ),
    ]


def _race(polls):
    return {
        "id": "ia-senate-2026",
        "election_date": "2026-11-03",
        "candidates": [{"name": "Ashley Hinson"}, {"name": "Josh Turek"}],
        "polling": polls,
    }


@pytest.mark.parametrize("left, right", _ia_pairs())
def test_ia_pairs_are_the_same_survey(left, right):
    assert pollster_identities_compatible(left, right)
    assert is_relabeled_same_survey(left, right)
    assert is_relabeled_same_survey(right, left)
    assert is_same_poll(left, right)


def test_sanitize_collapses_the_ia_duplicates_to_three_rich_records():
    polls = [poll for pair in _ia_pairs() for poll in pair]
    race = _race(copy.deepcopy(polls))
    _sanitize_polling(race)
    by_date = {p["date"]: p for p in race["polling"]}
    assert sorted(by_date) == ["2026-10-11", "2026-10-12", "2026-10-13"]

    marist = by_date["2026-10-11"]
    # Richer copy is the base (sample size + primary-source URL); date and label are the
    # earlier field-end copy's.
    assert marist["pollster"] == "Marist University"
    assert marist["sample_size"] == 1100
    assert marist["source_url"] == "https://maristpoll.marist.edu/iowa-2026"
    assert by_date["2026-10-12"]["sample_size"] == 678
    assert by_date["2026-10-13"]["sample_size"] == 602

    # The guard does not re-add the merged-away copies.
    assert restore_dropped_baseline_polls(race, polls) == []
    assert len(race["polling"]) == 3

    # A later refresh that re-finds the release copies does not duplicate them either.
    handlers = _make_editing_handlers(race, lambda *_a, **_k: None)
    for _, release in _ia_pairs():
        assert "same survey" in handlers["add_poll"](release)
    assert len(race["polling"]) == 3


def test_merge_fills_missing_fields_from_the_other_copy():
    bare = _poll("Marist University", "2026-10-11", 45, 48, 1100, url=None)
    sourced = _poll("Marist Poll", "2026-10-15", 45, 48, url="https://maristpoll.marist.edu/iowa-2026")
    kept, removed = merge_relabeled_survey_polls([bare, sourced])
    assert len(kept) == 1 and len(removed) == 1
    merged = kept[0]
    assert merged["sample_size"] == 1100
    assert merged["source_url"] == "https://maristpoll.marist.edu/iowa-2026"
    assert merged["date"] == "2026-10-11"


def test_add_poll_merges_a_relabeled_copy_instead_of_duplicating():
    race = _race([])
    handlers = _make_editing_handlers(race, lambda *_a, **_k: None)
    handlers["add_poll"](_poll("National Public Affairs", "2026-10-20", 47, 44, 678, url="https://npa.example/ia"))
    result = handlers["add_poll"](
        _poll("NPA Polling", "2026-10-12", 47, 44, url="https://npa.example/ia-oct.pdf", turek_first=True)
    )
    assert "same survey" in result
    assert len(race["polling"]) == 1
    assert race["polling"][0]["date"] == "2026-10-12"
    assert race["polling"][0]["sample_size"] == 678


def test_different_sample_sizes_are_distinct_surveys():
    left = _poll("Marist University", "2026-10-11", 45, 48, 1000)
    right = _poll("Marist Poll", "2026-10-15", 45, 48, 1100)
    assert not is_relabeled_same_survey(left, right)
    assert not is_same_poll(left, right)
    race = _race([left, right])
    _sanitize_polling(race)
    assert len(race["polling"]) == 2


def test_unrelated_pollsters_with_identical_toplines_stay_separate():
    left = _poll("Emerson College", "2026-10-10", 45, 48, 800)
    right = _poll("Cygnal", "2026-10-16", 45, 48, 800, turek_first=True)
    assert not pollster_identities_compatible(left, right)
    assert not is_relabeled_same_survey(left, right)
    assert not is_same_poll(left, right)
    race = _race([left, right])
    _sanitize_polling(race)
    assert len(race["polling"]) == 2


def test_same_pollster_with_different_toplines_stays_separate():
    left = _poll("Marist University", "2026-10-11", 45, 48, 1100)
    right = _poll("Marist Poll", "2026-10-15", 46, 48, 1100)
    assert not is_relabeled_same_survey(left, right)
    race = _race([left, right])
    _sanitize_polling(race)
    assert len(race["polling"]) == 2


def test_identical_label_on_two_dates_stays_two_waves():
    # ks-senate-2026: InsiderAdvantage 10-10 and 10-14 repeated a topline and are distinct waves.
    left = _poll("InsiderAdvantage", "2026-10-10", 48, 47, 1200)
    right = _poll("InsiderAdvantage", "2026-10-14", 48, 47, 1200, turek_first=True)
    assert not is_relabeled_same_survey(left, right)


def test_beyond_fourteen_days_is_a_different_survey():
    left = _poll("Marist University", "2026-10-01", 45, 48)
    right = _poll("Marist Poll", "2026-10-16", 45, 48, 1100)
    assert not is_relabeled_same_survey(left, right)


def test_generic_words_alone_do_not_make_pollsters_compatible():
    left = {"pollster": "Public Policy Polling"}
    right = {"pollster": "National Research Group"}
    assert not pollster_identities_compatible(left, right)
