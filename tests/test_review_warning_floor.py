from pipeline_client.agent.review import compute_validation_grade


def test_approved_profile_with_many_warnings_stays_publishable():
    grade = compute_validation_grade(
        [
            {
                "model": "reviewer",
                "score": 95,
                "verdict": "approved",
                "flags": [
                    {"field": f"candidates[1].issues.issue_{index}.sources", "severity": "warning"} for index in range(9)
                ],
            }
        ],
        min_reviews=1,
    )

    assert grade == {
        "grade": "B",
        "score": 80,
        "passed": True,
        "summary": "Validated by 1/1 reviewers at 80/100 after a 15-point advisory deduction for 9 warning flag(s).",
        "current_review_count": 1,
        "stale_review_count": 0,
    }


def _approvals(score: int = 92, count: int = 3):
    return [{"model": f"reviewer-{i}", "verdict": "approved", "score": score, "flags": []} for i in range(count)]


def _race(*, stances: bool):
    issues = (
        {"Healthcare": {"stance": "Supports expanding coverage.", "sources": [{"url": "https://e.com"}]}} if stances else {}
    )
    return {"candidates": [{"name": "A Candidate", "issues": issues}]}


def test_grade_is_withheld_when_the_race_has_no_issue_stances():
    """az-06-house-2026 sat live at A/92 with zero stances for all four candidates.

    Three reviewers approving a race whose substance was never collected reads
    to a voter as "we checked this"; saying nothing is the honest answer.
    """
    assert compute_validation_grade(_approvals(), _race(stances=False)) is None


def test_grade_is_reported_when_stances_exist():
    grade = compute_validation_grade(_approvals(), _race(stances=True))

    assert grade is not None
    assert grade["grade"] == "A"
    assert grade["passed"] is True


def test_grade_without_race_context_is_unchanged():
    """The race argument is optional; existing callers keep their behaviour."""
    grade = compute_validation_grade(_approvals())

    assert grade is not None and grade["grade"] == "A"


def test_a_race_with_no_candidates_still_grades():
    """An empty roster is a different defect and is not this check's business."""
    assert compute_validation_grade(_approvals(), {"candidates": []}) is not None


def test_single_usable_review_cannot_pass_when_quorum_is_two():
    grade = compute_validation_grade(_approvals(score=97, count=1))

    assert grade["passed"] is False
    assert grade["score"] == 97
    assert "quorum of 2" in grade["summary"]


def test_scores_are_clamped_and_bools_rejected():
    reviews = [
        {"model": "a", "verdict": "approved", "score": 250, "flags": []},
        {"model": "b", "verdict": "approved", "score": 90, "flags": []},
        {"model": "c", "verdict": "approved", "score": True, "flags": []},
    ]
    grade = compute_validation_grade(reviews)

    # 250 clamps to 100; the boolean is not a score at all.
    assert grade["score"] == 95
    assert grade["passed"] is True


def test_boolean_scores_do_not_count_toward_quorum():
    reviews = [
        {"model": "a", "verdict": "approved", "score": 95, "flags": []},
        {"model": "b", "verdict": "approved", "score": True, "flags": []},
    ]
    assert compute_validation_grade(reviews)["passed"] is False


def test_review_quorum_respects_configured_seats():
    from pipeline_client.agent.review import review_quorum

    assert review_quorum(None) == 2
    assert review_quorum(["claude", "gemini", "grok"]) == 2
    assert review_quorum(["claude"]) == 1


async def _no_links(*_a, **_kw):
    return None


def test_failed_reviewer_records_review_step_failure(monkeypatch):
    import asyncio

    from pipeline_client.agent import review as review_module

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    async def fake_call(system, user, *, model, run_budget=None):
        if "gemini" in model:
            raise RuntimeError("upstream exploded")
        return '{"verdict": "approved", "score": 93, "flags": [], "summary": "ok"}', {}

    monkeypatch.setattr(review_module, "_call_review_model", fake_call)
    monkeypatch.setattr(review_module, "check_profile_links", _no_links)
    monkeypatch.setattr(review_module, "validate_semantic_review_packet", lambda *a, **k: None)
    monkeypatch.setattr(review_module, "build_semantic_review_packet", lambda race: {"race": "x"})
    monkeypatch.setattr(review_module, "serialize_semantic_review_packet", lambda packet: "{}")
    race = {"id": "x-2026", "candidates": [{"name": "A"}]}

    reviews = asyncio.run(review_module.run_reviews("x-2026", race, review_providers=["claude", "gemini"]))

    model_reviews = [r for r in reviews if not str(r.get("model", "")).startswith("automated")]
    assert len(model_reviews) == 1
    failures = race["pipeline_state"]["step_failures"]
    assert any(f["step"] == "review" and "gemini" in f["detail"] for f in failures)
