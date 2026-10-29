"""Reviewer output truncation: the cap, the bounded prompt, the retry, and visibility."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from pipeline_client.agent import review as review_module
from shared.model_catalog import DEFAULT_REVIEW_CLAUDE, MODEL_CATALOG
from shared.run_health import RunFailureReason, record_step_failure

VALID = json.dumps({"verdict": "approved", "score": 92, "summary": "Well sourced.", "flags": []})
TRUNCATED = '{"verdict": "needs_revision", "score": 78, "summary": "x", "flags": [{"field": "candidates[0].issues'


def _usage(finish_reason="stop", completion_tokens=500):
    return {"prompt_tokens": 1000, "completion_tokens": completion_tokens, "finish_reason": finish_reason}


async def _no_links(*_a, **_kw):
    return None


def _patch_packet(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(review_module, "check_profile_links", _no_links)
    monkeypatch.setattr(review_module, "validate_semantic_review_packet", lambda *a, **k: None)
    monkeypatch.setattr(review_module, "build_semantic_review_packet", lambda race: {"race": "x"})
    monkeypatch.setattr(review_module, "serialize_semantic_review_packet", lambda packet: "{}")


def _fake_response(content, finish_reason="stop", completion_tokens=500):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)],
        usage=SimpleNamespace(prompt_tokens=1000, completion_tokens=completion_tokens),
    )


def test_anthropic_reviewer_call_gets_raised_cap_within_catalog_limit():
    mock = AsyncMock(return_value=_fake_response(VALID))
    with patch("pipeline_client.agent.review._call_openrouter", mock):
        raw, usage = asyncio.run(review_module._call_review_model("s", "u", model=DEFAULT_REVIEW_CLAUDE))

    sent = mock.call_args.kwargs["max_tokens"]
    assert sent == review_module.REVIEW_MAX_TOKENS
    assert sent > 8192
    assert sent <= MODEL_CATALOG[DEFAULT_REVIEW_CLAUDE].max_completion_tokens
    assert usage["finish_reason"] == "stop"
    assert raw == VALID


def test_review_cap_is_clamped_to_model_maximum(monkeypatch):
    small = SimpleNamespace(max_completion_tokens=4096)
    monkeypatch.setitem(review_module.MODEL_CATALOG, "test/small-model", small)
    assert review_module._review_max_tokens("test/small-model") == 4096


def test_review_prompt_bounds_flag_count():
    captured = []

    async def fake_call(system, user, *, model, run_budget=None):
        captured.append(user)
        return VALID, _usage()

    with patch.object(review_module, "_call_review_model", fake_call):
        result = asyncio.run(review_module._run_single_review("x-2026", "{}", provider="claude"))

    assert result is not None
    assert f"at most {review_module.REVIEW_MAX_FLAGS} flags" in captured[0]
    assert "JSON object only" in captured[0]


def test_truncated_reply_is_retried_once_with_tighter_bound():
    calls = []

    async def fake_call(system, user, *, model, run_budget=None):
        calls.append(user)
        if len(calls) == 1:
            return TRUNCATED, _usage("length", 16384)
        return VALID, _usage()

    metrics: dict = {}
    with patch.object(review_module, "_call_review_model", fake_call):
        result = asyncio.run(review_module._run_single_review("x-2026", "{}", provider="claude", metrics_sink=metrics))

    assert result is not None and result["score"] == 92
    assert len(calls) == 2
    assert f"at most {review_module.REVIEW_RETRY_MAX_FLAGS} flags" in calls[1]
    assert "cut off at the completion limit" in calls[1]
    claude = metrics["providers"]["claude"]
    assert claude["calls"] == 2
    assert claude["truncated_calls"] == 1
    assert claude["parse_failures"] == 1
    assert claude["completion_tokens"] == 16384 + 500


def test_persistently_truncated_reviewer_is_recorded_as_step_failure(monkeypatch):
    _patch_packet(monkeypatch)
    claude_calls = []

    async def fake_call(system, user, *, model, run_budget=None):
        if "anthropic" in model:
            claude_calls.append(user)
            return TRUNCATED, _usage("length", 16384)
        return VALID, _usage()

    monkeypatch.setattr(review_module, "_call_review_model", fake_call)
    race = {"id": "x-2026", "candidates": [{"name": "A"}]}

    reviews = asyncio.run(review_module.run_reviews("x-2026", race, cheap_mode=True))

    assert len(claude_calls) == 2  # one retry, no more
    model_reviews = [r for r in reviews if not str(r.get("model", "")).startswith("automated")]
    assert {r["model"] for r in model_reviews} == {
        review_module._review_model_for("gemini", cheap_mode=True),
        review_module._review_model_for("grok", cheap_mode=True),
    }
    failures = [f for f in race["pipeline_state"]["step_failures"] if f["step"] == "review"]
    assert len(failures) == 1
    detail = failures[0]["detail"]
    assert "claude reviewer failed" in detail
    assert "truncated JSON" in detail
    assert "finish_reason=length" in detail


def test_two_failed_seats_with_same_reason_are_both_named(monkeypatch):
    _patch_packet(monkeypatch)

    async def fake_call(system, user, *, model, run_budget=None):
        if "anthropic" in model:
            return TRUNCATED, _usage("length", 16384)
        if "gemini" in model:
            return "not json at all", _usage()
        return VALID, _usage()

    monkeypatch.setattr(review_module, "_call_review_model", fake_call)
    race = {"id": "x-2026", "candidates": [{"name": "A"}]}

    asyncio.run(review_module.run_reviews("x-2026", race, cheap_mode=True))

    failures = [f for f in race["pipeline_state"]["step_failures"] if f["step"] == "review"]
    assert len(failures) == 1
    assert "claude reviewer failed: truncated JSON" in failures[0]["detail"]
    assert "gemini reviewer failed: malformed JSON" in failures[0]["detail"]


def test_valid_three_reviewer_panel_records_all_three(monkeypatch):
    _patch_packet(monkeypatch)
    seen_models = []

    async def fake_call(system, user, *, model, run_budget=None):
        seen_models.append(model)
        return VALID, _usage()

    monkeypatch.setattr(review_module, "_call_review_model", fake_call)
    race = {"id": "x-2026", "candidates": [{"name": "A"}]}

    reviews = asyncio.run(review_module.run_reviews("x-2026", race, cheap_mode=True))

    model_reviews = [r for r in reviews if not str(r.get("model", "")).startswith("automated")]
    expected = {review_module._review_model_for(p, cheap_mode=True) for p in ("claude", "gemini", "grok")}
    assert DEFAULT_REVIEW_CLAUDE in expected
    assert {r["model"] for r in model_reviews} == expected
    assert len(model_reviews) == 3
    assert len(seen_models) == 3  # no retries on valid replies
    assert not [f for f in (race.get("pipeline_state") or {}).get("step_failures", []) if f["step"] == "review"]


@pytest.mark.parametrize("merge", [False, True])
def test_record_step_failure_merge_detail(merge):
    race: dict = {}
    record_step_failure(race, "review", RunFailureReason.STEP_NO_DATA, "a failed", merge_detail=merge)
    record_step_failure(race, "review", RunFailureReason.STEP_NO_DATA, "b failed", merge_detail=merge)
    record_step_failure(race, "review", RunFailureReason.STEP_NO_DATA, "b failed", merge_detail=merge)
    failures = race["pipeline_state"]["step_failures"]
    assert len(failures) == 1
    assert failures[0]["detail"] == ("a failed; b failed" if merge else "a failed")


# A truncated object whose first inner array is complete: the bracket walker
# used to return that inner list, hiding the truncation from the retry path.
TRUNCATED_WITH_INNER_LIST = '{"verdict": "needs_revision", "flags": [{"field": "a", "severity": "low"}], "summary": "cut'


def test_extract_json_does_not_return_inner_list_of_truncated_object():
    with pytest.raises(json.JSONDecodeError):
        review_module._extract_json(TRUNCATED_WITH_INNER_LIST)
    with pytest.raises(json.JSONDecodeError):
        review_module._extract_json("```json\n" + TRUNCATED_WITH_INNER_LIST)


def test_truncated_object_with_inner_list_triggers_retry():
    calls = []

    async def fake_call(system, user, *, model, run_budget=None):
        calls.append(user)
        if len(calls) == 1:
            return TRUNCATED_WITH_INNER_LIST, _usage("length", 16384)
        return VALID, _usage()

    with patch.object(review_module, "_call_review_model", fake_call):
        result = asyncio.run(review_module._run_single_review("x-2026", "{}", provider="claude"))

    assert result is not None and result["score"] == 92
    assert len(calls) == 2


def test_list_reply_is_treated_as_parse_failure_and_retried():
    calls = []

    async def fake_call(system, user, *, model, run_budget=None):
        calls.append(user)
        if len(calls) == 1:
            return '[{"field": "a"}]', _usage()
        return VALID, _usage()

    with patch.object(review_module, "_call_review_model", fake_call):
        result = asyncio.run(review_module._run_single_review("x-2026", "{}", provider="claude"))

    assert result is not None and result["score"] == 92
    assert len(calls) == 2
    assert "was not a JSON object" in calls[1]
