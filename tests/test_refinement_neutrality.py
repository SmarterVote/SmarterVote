"""Refinement treats neutrality-lint hits as required edits (LLM mocked)."""

import pytest

import pipeline_client.agent.phases as phases
from pipeline_client.agent.agent import _build_run_audit
from pipeline_client.agent.phases.context import PhaseContext
from pipeline_client.agent.phases.refinement import run_refinement_phase

GUNS = "Firearms & Second Amendment"
LOADED = "Ken Paxton is an uncompromising defender of the Second Amendment and opposes new gun limits."
NEUTRAL = "Ken Paxton opposes new gun limits and has defended the Second Amendment in court."
SOURCED_ECONOMY = "Supports cutting the state franchise tax."


def _race():
    source = [{"url": "https://example.com/paxton", "type": "website"}]
    return {
        "id": "tx-senate-2026",
        "description": "A Texas Senate race.",
        "candidates": [
            {
                "name": "Jane Doe",
                "issues": {"Economy": {"stance": "Backs a minimum wage increase.", "confidence": "high", "sources": source}},
            },
            {
                "name": "Ken Paxton",
                "issues": {
                    GUNS: {"stance": LOADED, "confidence": "high", "sources": source},
                    "Economy": {"stance": SOURCED_ECONOMY, "confidence": "high", "sources": source},
                },
            },
        ],
    }


def _ctx(race_json, selected=("Jane Doe", "Ken Paxton")):
    return PhaseContext(
        race_json=race_json,
        race_id=race_json["id"],
        model="writer",
        small_model="small",
        on_log=None,
        log=lambda *_a, **_kw: None,
        max_iterations=4,
        step_enabled=lambda step: step == "refinement",
        track=lambda *_a, **_kw: None,
        candidate_names=list(selected),
        selected_name_set=set(selected),
    )


def _install_fake_loop(monkeypatch, rewrite_on_call=None):
    """Record every agent-loop call; on the given call numbers, rewrite the loaded stance."""
    calls = []

    async def fake_loop(system, user, **kwargs):
        calls.append({"user": user, **kwargs})
        if rewrite_on_call and len(calls) in rewrite_on_call:
            kwargs["extra_tool_handlers"]["set_issue_stance"](
                {"candidate_name": "Ken Paxton", "issue": GUNS, "stance": NEUTRAL, "confidence": "high"}
            )
        return {}

    async def fake_hints(_race_json, _name):
        return "https://example.com", []

    monkeypatch.setattr(phases, "_agent_loop", fake_loop)
    monkeypatch.setattr(phases, "_candidate_source_hints", fake_hints)
    return calls


def _phase_calls(calls, marker):
    return [call for call in calls if marker in call["phase_name"]]


@pytest.mark.asyncio
async def test_flagged_stance_is_in_must_fix_list_and_unflagged_is_not(monkeypatch):
    race = _race()
    calls = _install_fake_loop(monkeypatch, rewrite_on_call={2})

    await run_refinement_phase(_ctx(race))

    paxton_prompt = _phase_calls(calls, "refine-Ken Paxton")[0]["user"]
    assert "MUST-FIX" in paxton_prompt
    assert f"candidates[1].issues.{GUNS}.stance" in paxton_prompt
    assert '"uncompromising"' in paxton_prompt
    # A sourced, neutral stance is not forced into the must-fix list.
    must_fix_block = paxton_prompt.split("MUST-FIX", 1)[1]
    assert "issues.Economy.stance" not in must_fix_block
    # A candidate with no hits gets the ordinary prompt.
    assert "MUST-FIX" not in _phase_calls(calls, "refine-Jane Doe")[0]["user"]
    assert "MUST-FIX" not in _phase_calls(calls, "refine-meta")[0]["user"]
    # Fixed on the first pass: no retry, nothing recorded.
    assert not _phase_calls(calls, "neutrality")
    assert race["candidates"][1]["issues"][GUNS]["stance"] == NEUTRAL
    assert race["candidates"][1]["issues"][GUNS]["sources"]
    assert "neutrality_unfixed" not in race["pipeline_state"]


@pytest.mark.asyncio
async def test_retry_runs_once_with_same_model_and_fixes_hit(monkeypatch):
    race = _race()
    # Call 1: Jane, call 2: Paxton (ignores must-fix), call 3: Paxton retry (fixes it).
    calls = _install_fake_loop(monkeypatch, rewrite_on_call={3})

    await run_refinement_phase(_ctx(race))

    retries = _phase_calls(calls, "neutrality")
    assert len(retries) == 1
    assert retries[0]["model"] == "writer"
    assert retries[0]["allow_search_tools"] is False
    assert f"candidates[1].issues.{GUNS}.stance" in retries[0]["user"]
    assert "neutrality_unfixed" not in race["pipeline_state"]


@pytest.mark.asyncio
async def test_unfixed_hit_after_one_retry_is_recorded_in_run_audit(monkeypatch):
    race = _race()
    calls = _install_fake_loop(monkeypatch)  # never rewrites

    await run_refinement_phase(_ctx(race))

    assert len(_phase_calls(calls, "neutrality")) == 1
    field = f"candidates[1].issues.{GUNS}.stance"
    assert race["pipeline_state"]["neutrality_unfixed"] == [field]

    audit = _build_run_audit(None, race)
    assert audit["neutrality_unfixed"] == [f'{field}: "uncompromising"']
    assert any("loaded wording" in note for note in audit["publish_attention"])

    # Fixed later in the run (e.g. by iteration): the audit no longer reports it.
    race["candidates"][1]["issues"][GUNS]["stance"] = NEUTRAL
    assert _build_run_audit(None, race)["neutrality_unfixed"] == []


@pytest.mark.asyncio
async def test_candidate_scoping_leaves_unselected_candidates_alone(monkeypatch):
    race = _race()
    calls = _install_fake_loop(monkeypatch)

    await run_refinement_phase(_ctx(race, selected=("Jane Doe",)))

    assert not _phase_calls(calls, "Ken Paxton")
    assert not _phase_calls(calls, "neutrality")
    assert all("MUST-FIX" not in call["user"] for call in calls)
    assert "neutrality_unfixed" not in race["pipeline_state"]


@pytest.mark.asyncio
async def test_loaded_race_description_is_forced_into_meta_refinement(monkeypatch):
    race = _race()
    race["description"] = "Paxton, a firebrand attorney general, faces a Democratic challenger in this Senate race."
    calls = _install_fake_loop(monkeypatch)

    await run_refinement_phase(_ctx(race, selected=("Jane Doe",)))

    meta_prompt = _phase_calls(calls, "refine-meta")[0]["user"]
    assert "MUST-FIX" in meta_prompt and "- description" in meta_prompt
    assert len(_phase_calls(calls, "refine-meta-neutrality")) == 1
    assert race["pipeline_state"]["neutrality_unfixed"] == ["description"]
