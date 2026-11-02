"""The checks that stand between a pipeline run and a published winner."""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from pipeline_client.agent.handlers import _make_results_handlers
from pipeline_client.agent.web_tools import _fresh_reads_only, fresh_web_reads
from shared.election_results import poll_close_utc, post_election_frozen_steps, result_index_entry, validate_race_result
from shared.models import RaceResult
from shared.pipeline_config import EXPLICIT_ONLY_PIPELINE_STEPS

AFTER_CLOSE = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)
RACE = {
    "id": "oh-governor-2026",
    "state": "Ohio",
    "election_date": "2026-11-03",
    "candidates": [{"name": "Ann Lee", "party": "Democratic"}, {"name": "Bob Ray", "party": "Republican"}],
}
SOURCES = [
    {"url": "https://www.cleveland.com/results", "type": "news"},
    {"url": "https://www.dispatch.com/results", "type": "news"},
]


def called(**overrides):
    return {
        "status": "called",
        "winner_name": "Ann Lee",
        "called_by": "AP",
        "called_at": "2026-11-04T03:00:00Z",
        "candidates": [{"name": "Ann Lee", "pct": 52.0, "votes": 100}, {"name": "Bob Ray", "pct": 48.0, "votes": 90}],
        "sources": SOURCES,
        "as_of": "2026-11-04T03:05:00Z",
        **overrides,
    }


def errors_for(result, previous=None, now=AFTER_CLOSE):
    return validate_race_result(result, RACE, previous=previous, now=now)


def test_a_fully_sourced_call_passes():
    assert errors_for(called()) == []


def test_nothing_is_accepted_before_polls_close():
    before = datetime(2026, 11, 3, 23, tzinfo=timezone.utc)
    assert any("do not close" in error for error in errors_for(called(), now=before))


def test_poll_close_is_the_states_last_close_and_unknown_states_wait_longest():
    # 7:30 and 8 p.m. Eastern, which is UTC-5 on Election Day.
    assert poll_close_utc("Ohio") == datetime(2026, 11, 4, 0, 30, tzinfo=timezone.utc)
    assert poll_close_utc("Florida") == datetime(2026, 11, 4, 1, tzinfo=timezone.utc)
    assert poll_close_utc("Alaska") == datetime(2026, 11, 4, 6, tzinfo=timezone.utc)
    assert poll_close_utc("Alaska") == poll_close_utc("Atlantis")


def test_a_primary_article_cannot_support_a_general_election_result():
    old = [{**SOURCES[0], "published_at": "2026-05-05T00:00:00Z"}, SOURCES[1]]
    assert any("primary" in error for error in errors_for(called(sources=old)))


def test_the_winner_must_be_on_the_roster():
    assert any("not on the race roster" in error for error in errors_for(called(winner_name="Cal Poe")))


@pytest.mark.parametrize(
    "overrides",
    [
        {"called_by": None},
        {"called_at": None},
        {"sources": SOURCES[:1]},
        {"sources": [SOURCES[0], {"url": "https://cleveland.com/other", "type": "news"}]},
    ],
)
def test_a_call_needs_a_named_caller_and_two_independent_sources(overrides):
    assert errors_for(called(**overrides))


def test_a_vote_lead_cannot_name_a_winner():
    assert any("must not name a winner" in error for error in errors_for(called(status="counting")))


def test_certification_needs_an_official_source():
    assert errors_for(called(status="certified"))
    official = [{"url": "https://www.ohiosos.gov/results", "type": "government"}]
    assert errors_for(called(status="certified", sources=official)) == []


def test_impossible_counts_are_rejected():
    rows = [{"name": "Ann Lee", "pct": 70.0}, {"name": "Bob Ray", "pct": 40.0}]
    assert any("total" in error for error in errors_for(called(candidates=rows)))


def test_a_runoff_needs_a_later_date():
    assert errors_for(called(status="runoff_required", winner_name=None))
    ok = called(status="runoff_required", winner_name=None, runoff_date="2026-12-01")
    assert errors_for(ok) == []


@pytest.mark.parametrize(
    "change",
    [
        {"status": "counting", "winner_name": None},
        {"winner_name": "Bob Ray"},
        {"candidates": [{"name": "Ann Lee", "votes": 50}]},
    ],
)
def test_moving_backward_needs_a_correction_note(change):
    assert errors_for(called(**change), previous=called())
    assert errors_for(called(**change, correction_note="AP retracted its call"), previous=called()) == []


def test_handler_never_stores_a_rejected_result():
    race = {**RACE, "candidates": list(RACE["candidates"])}
    handler = _make_results_handlers(race, lambda *_: None)["record_race_result"]
    with patch("pipeline_client.agent.handlers.validate_race_result", return_value=["bad"]):
        assert handler(called()).startswith("Rejected")
    assert "result" not in race


def test_handler_output_matches_the_public_schema():
    race = {**RACE}
    handler = _make_results_handlers(race, lambda *_: None)["record_race_result"]
    with patch("pipeline_client.agent.handlers.validate_race_result", return_value=[]):
        assert handler(called()).startswith("Recorded")
    model = RaceResult.model_validate({**race["result"], "sources": [{**s, "last_accessed": AFTER_CLOSE} for s in SOURCES]})
    assert model.winner_party == "Democratic"
    assert race["result"]["candidates"][1]["party"] == "Republican"


def test_results_step_is_never_part_of_a_default_run():
    assert EXPLICIT_ONLY_PIPELINE_STEPS == {"results"}


def test_steps_freeze_only_after_this_states_polls_close(monkeypatch):
    monkeypatch.delenv("PIPELINE_ALLOW_POST_ELECTION_STEPS", raising=False)
    before = datetime(2026, 11, 3, 23, tzinfo=timezone.utc)
    assert post_election_frozen_steps(RACE, now=before) == frozenset()
    assert post_election_frozen_steps(RACE, now=AFTER_CLOSE) == {"discovery", "polling", "forecast"}
    assert post_election_frozen_steps({**RACE, "election_date": "2026-12-01"}, now=AFTER_CLOSE) == frozenset()


def test_fresh_reads_flag_resets():
    with fresh_web_reads():
        assert _fresh_reads_only.get() is True
    assert _fresh_reads_only.get() is False


def test_public_index_entry_limits_sources():
    race = {**RACE, "title": "Ohio Governor", "result": called(sources=SOURCES * 2)}
    entry = result_index_entry("oh-governor-2026", race)
    assert entry["winner_name"] == "Ann Lee"
    assert len(entry["sources"]) == 2
    assert result_index_entry("x", RACE) is None
