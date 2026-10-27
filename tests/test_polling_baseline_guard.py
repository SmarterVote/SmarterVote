"""A poll stored before a polling run is never silently lost by that run.

ks-senate-2026 lost InsiderAdvantage 2026-10-10 beside its 2026-10-14 release (and,
earlier, NYT/Siena 2026-09-30); ne-governor-2026 lost NPA Polling 2026-10-05 beside the
2026-10-18 release. remove_poll accepted "superseded by newer poll" and a pollster-only
call removed every survey by that pollster.
"""

from __future__ import annotations

import copy
from unittest.mock import patch

import pytest

from pipeline_client.agent.agent import _sanitize_polling
from pipeline_client.agent.handlers import _make_editing_handlers
from pipeline_client.agent.phases.context import PhaseContext
from pipeline_client.agent.phases.polling import run_polling_phase
from pipeline_client.agent.polling_quality import is_same_poll, restore_dropped_baseline_polls

KS = ["Josh Hamilton", "Roger Marshall"]
NE = ["Jim Pillen", "Tim Walz"]


def _poll(pollster, day, names, pcts, url, sample_size=None):
    poll = {
        "pollster": pollster,
        "date": day,
        "matchups": [{"candidates": list(names), "percentages": list(pcts)}],
        "source_url": url,
    }
    if sample_size:
        poll["sample_size"] = sample_size
    return poll


def _ks_race():
    return {
        "id": "ks-senate-2026",
        "candidates": [{"name": "Josh Hamilton"}, {"name": "Roger Marshall"}],
        "polling": [
            _poll("InsiderAdvantage", "2026-10-14", ["Roger Marshall", "Josh Hamilton"], [48, 47], "https://ia/oct14", 1200),
            _poll("InsiderAdvantage", "2026-10-10", ["Josh Hamilton", "Roger Marshall"], [48, 47], "https://ia/oct10", 1200),
            _poll("NYT/Siena", "2026-09-30", KS, [45, 49], "https://nyt/siena", 800),
        ],
    }


def _ne_race():
    return {
        "id": "ne-governor-2026",
        "candidates": [{"name": "Jim Pillen"}, {"name": "Tim Walz"}],
        "polling": [
            _poll("National Public Affairs", "2026-10-18", NE, [45, 41], "https://npa/oct18.pdf", 800),
            _poll("NPA Polling", "2026-10-05", NE, [44, 40], "https://npa/oct05.pdf", 800),
        ],
    }


def _ctx(race_json):
    return PhaseContext(
        race_json=race_json,
        race_id=race_json["id"],
        model="writer",
        small_model="small",
        on_log=None,
        log=lambda *_a, **_kw: None,
        max_iterations=4,
        step_enabled=lambda _s: True,
        track=lambda *_a, **_kw: None,
        is_update=True,
        candidate_names=[c["name"] for c in race_json["candidates"]],
        selected_name_set={c["name"] for c in race_json["candidates"]},
    )


async def _run_with_agent(race_json, agent_actions):
    """Run the polling phase with a fake agent that calls tools via *agent_actions*(handlers)."""
    results = []

    async def fake(system, user, **kwargs):
        results.extend(agent_actions(kwargs["extra_tool_handlers"]) or [])
        return {}

    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        await run_polling_phase(_ctx(race_json))
    return results


def _keys(race_json):
    return sorted((p["pollster"], p["date"]) for p in race_json["polling"])


# --- remove_poll ----------------------------------------------------------------


def test_remove_poll_blocks_superseded_reason():
    race = _ks_race()
    handlers = _make_editing_handlers(race, lambda *_: None)
    result = handlers["remove_poll"](
        {"pollster": "InsiderAdvantage", "date": "2026-10-10", "reason": "superseded by newer InsiderAdvantage poll"}
    )
    assert result.startswith("ERROR: Poll removal blocked")
    assert len(race["polling"]) == 3


def test_remove_poll_pollster_only_requires_date_when_several_surveys():
    race = _ks_race()
    handlers = _make_editing_handlers(race, lambda *_: None)
    result = handlers["remove_poll"]({"pollster": "InsiderAdvantage", "reason": "malformed"})
    assert result.startswith("ERROR:") and "2026-10-10" in result
    assert len(race["polling"]) == 3


def test_remove_poll_duplicate_reason_needs_a_real_duplicate():
    race = _ks_race()
    handlers = _make_editing_handlers(race, lambda *_: None)
    result = handlers["remove_poll"](
        {"pollster": "InsiderAdvantage", "date": "2026-10-10", "reason": "duplicate of the InsiderAdvantage poll"}
    )
    assert result.startswith("ERROR: Poll removal blocked")
    assert len(race["polling"]) == 3


def test_remove_poll_duplicate_copies_keep_one():
    race = {
        "candidates": [],
        "polling": [
            {"pollster": "SurveyUSA", "date": "2026-03-01", "matchups": [], "source_url": "https://a.com"},
            {"pollster": "SurveyUSA", "date": "2026-03-01", "matchups": [], "source_url": "https://b.com"},
        ],
    }
    handlers = _make_editing_handlers(race, lambda *_: None)
    assert handlers["remove_poll"]({"pollster": "SurveyUSA", "date": "2026-03-01", "reason": "duplicate"}).startswith(
        "Removed 1"
    )
    assert len(race["polling"]) == 1


def test_remove_poll_requires_reason():
    race = _ks_race()
    handlers = _make_editing_handlers(race, lambda *_: None)
    assert handlers["remove_poll"]({"pollster": "NYT/Siena", "date": "2026-09-30", "reason": ""}).startswith("ERROR")
    assert len(race["polling"]) == 3


# --- phase-level guard ----------------------------------------------------------


@pytest.mark.asyncio
async def test_ks_insideradvantage_oct10_and_oct14_both_kept():
    race = _ks_race()

    def agent(handlers):
        # The agent tries every route that dropped the Oct 10 poll in production.
        return [
            handlers["remove_poll"]({"pollster": "InsiderAdvantage", "date": "2026-10-10", "reason": "older poll"}),
            handlers["remove_poll"]({"pollster": "InsiderAdvantage", "reason": "superseded"}),
        ]

    await _run_with_agent(race, agent)
    assert ("InsiderAdvantage", "2026-10-10") in _keys(race)
    assert ("InsiderAdvantage", "2026-10-14") in _keys(race)
    assert ("NYT/Siena", "2026-09-30") in _keys(race)

    _sanitize_polling(race)
    assert len(race["polling"]) == 3


@pytest.mark.asyncio
async def test_lost_baseline_poll_is_restored_even_when_list_rewritten():
    """However a poll goes missing (e.g. a wholesale rewrite), the guard restores it."""
    race = _ks_race()

    def agent(_handlers):
        race["polling"] = [p for p in race["polling"] if p["date"] != "2026-09-30"]

    await _run_with_agent(race, agent)
    assert ("NYT/Siena", "2026-09-30") in _keys(race)


@pytest.mark.asyncio
async def test_ne_npa_oct05_restored_when_agent_output_lacks_it():
    race = _ne_race()

    def agent(handlers):
        # Production output: only the Oct 18 release remained, relabeled "NPA Polling (R)".
        race["polling"] = [_poll("NPA Polling (R)", "2026-10-18", NE, [45, 41], "https://npa/oct18.pdf", 800)]

    await _run_with_agent(race, agent)
    assert _keys(race) == [("NPA Polling", "2026-10-05"), ("NPA Polling (R)", "2026-10-18")]


@pytest.mark.asyncio
async def test_relabeled_pollster_is_not_duplicated():
    race = {
        "id": "xx-senate-2026",
        "candidates": [{"name": "Josh Hamilton"}, {"name": "Roger Marshall"}],
        "polling": [_poll("Trafalgar Group", "2026-10-01", KS, [44, 50], "https://trafalgar/a", 1080)],
    }

    def agent(handlers):
        race["polling"] = [_poll("Trafalgar Group (R)", "2026-10-01", KS, [44, 50], "https://trafalgar/b", 1080)]

    await _run_with_agent(race, agent)
    assert _keys(race) == [("Trafalgar Group (R)", "2026-10-01")]


@pytest.mark.asyncio
async def test_invalid_baseline_poll_may_still_be_removed():
    race = _ks_race()
    race["polling"].append(_poll("Emerson", "2026-10-02", ["Josh Hamilton", "Laura Kelly"], [40, 45], "https://e/1", 900))
    race["polling"].append(
        _poll("Kansas Secretary of State", "2026-08-04", KS, [52, 48], "https://sos.ks.gov/election-results/2026")
    )
    race["polling"].append(_poll("Fort Hays", "2026-09-15", KS, [41, 46], "https://fhsu/poll", 500))

    def agent(handlers):
        race["polling"] = [p for p in race["polling"] if p["pollster"] not in {"Emerson", "Kansas Secretary of State"}]
        return [
            handlers["remove_poll"](
                {"pollster": "Fort Hays", "date": "2026-09-15", "reason": "poll concerns the governor race, not this contest"}
            )
        ]

    results = await _run_with_agent(race, agent)
    assert results[0].startswith("Removed 1")
    pollsters = {p["pollster"] for p in race["polling"]}
    # Non-roster candidate and election returns are deterministically invalid; Fort Hays has a recorded reason.
    assert pollsters == {"InsiderAdvantage", "NYT/Siena"}


def test_same_survey_lv_rv_dedupe_still_works():
    race = {
        "candidates": [{"name": "Josh Hamilton"}, {"name": "Roger Marshall"}],
        "polling": [
            _poll("Beacon Research - registered voters", "2026-10-12", KS, [44, 46], "https://fox/poll", 1000),
            _poll("Beacon Research", "2026-10-12", KS, [45, 47], "https://fox/poll", 900),
            _poll("Beacon Research", "2026-10-02", KS, [43, 48], "https://fox/poll-earlier", 900),
        ],
    }
    baseline = copy.deepcopy(race["polling"])
    _sanitize_polling(race)
    assert _keys(race) == [("Beacon Research", "2026-10-02"), ("Beacon Research", "2026-10-12")]
    # The RV variant is the same survey as the kept LV row: the guard does not bring it back.
    assert restore_dropped_baseline_polls(race, baseline) == []
    assert len(race["polling"]) == 2


def test_is_same_poll_distinguishes_dates_and_matches_relabels():
    oct10 = _poll("InsiderAdvantage", "2026-10-10", ["Josh Hamilton", "Roger Marshall"], [48, 47], "https://ia/oct10", 1200)
    oct14 = _poll("InsiderAdvantage", "2026-10-14", ["Roger Marshall", "Josh Hamilton"], [48, 47], "https://ia/oct14", 1200)
    assert not is_same_poll(oct10, oct14)
    relabel = dict(oct10, pollster="InsiderAdvantage (R)")
    assert is_same_poll(oct10, relabel)


def test_numberless_polls_from_different_pollsters_are_not_collapsed():
    race = {
        "candidates": [{"name": "Josh Hamilton"}, {"name": "Roger Marshall"}],
        "polling": [
            {"pollster": "Pollster A", "date": "2026-10-01", "matchups": [], "source_url": "https://a"},
            {"pollster": "Pollster B", "date": "2026-10-02", "matchups": [], "source_url": "https://b"},
        ],
    }
    _sanitize_polling(race)
    assert len(race["polling"]) == 2
