"""Stance citations the run never observed are flagged (not blocked)."""

from pipeline_client.agent import cost
from pipeline_client.agent.agent import _build_run_audit
from pipeline_client.agent.handlers import _make_editing_handlers


def _race():
    return {"id": "x-house-01-2026", "candidates": [{"name": "Alice", "issues": {}}]}


def _stance(url, trace):
    args = {
        "candidate_name": "Alice",
        "issue": "Healthcare",
        "stance": "Supports a stated policy.",
        "confidence": "high",
        "sources": [{"url": url}],
    }
    if trace is not None:
        args["_research_trace"] = trace
    return args


def test_unobserved_citation_is_recorded_but_stance_is_still_set():
    token = cost._cost_ctx.set({"prompt_tokens": 0, "completion_tokens": 0})
    try:
        race = _race()
        handlers = _make_editing_handlers(race, lambda *_a: None)
        result = handlers["set_issue_stance"](
            _stance("https://planted.example/fake", {"researched_urls": ["https://real.example/a"], "fetched_urls": []})
        )
        assert not result.startswith("ERROR")
        assert race["candidates"][0]["issues"]["Healthcare"]["stance"] == "Supports a stated policy."
        assert cost.unobserved_citations() == ["Alice / Healthcare: https://planted.example/fake"]
        audit = _build_run_audit(None, race)
        assert any("never fetched or seen" in note for note in audit["publish_attention"])
    finally:
        cost._cost_ctx.reset(token)


def test_observed_citation_is_not_flagged():
    token = cost._cost_ctx.set({"prompt_tokens": 0, "completion_tokens": 0})
    try:
        race = _race()
        handlers = _make_editing_handlers(race, lambda *_a: None)
        handlers["set_issue_stance"](
            _stance("https://real.example/a/", {"researched_urls": [], "fetched_urls": ["https://REAL.example/a"]})
        )
        assert cost.unobserved_citations() == []
    finally:
        cost._cost_ctx.reset(token)


def test_direct_handler_calls_without_a_trace_are_not_flagged():
    token = cost._cost_ctx.set({"prompt_tokens": 0, "completion_tokens": 0})
    try:
        race = _race()
        _make_editing_handlers(race, lambda *_a: None)["set_issue_stance"](_stance("https://x.example/", None))
        assert cost.unobserved_citations() == []
    finally:
        cost._cost_ctx.reset(token)
