"""Pipeline-side fixes for live-site audit 4 (2026-10-01).

Each block names the audit finding it guards. Everything here is deterministic
or uses fakes: no network, no model calls.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from pipeline_client.agent.phases.forecast import deterministic_forecast_text, replace_unverified_forecast_text
from pipeline_client.agent.review import NEUTRALITY_SCORE_CAP, check_profile_quality, compute_validation_grade
from shared.models import ValidationGrade
from shared.neutrality import find_loaded_language, is_neutrality_flag, neutrality_flags
from shared.party_labels import normalize_party
from shared.race_cleanup import cleanup_race_data
from shared.text_quality import (
    NO_POSITION_MARKER,
    clean_pipeline_language,
    is_no_position_variant,
    is_placeholder_text,
    normalize_no_position_stance,
)

# ---------------------------------------------------------------------------
# #2 Unverified forecast text is replaced by a plain summary of the numbers
# ---------------------------------------------------------------------------


def _forecast_race():
    return {
        "id": "ca-governor-2026",
        "candidates": [
            {"name": "Xavier Becerra", "party": "Democratic"},
            {"name": "Steve Hilton", "party": "Republican"},
        ],
        "polling": [
            {"pollster": "PPIC", "matchups": [{"candidates": ["Xavier Becerra", "Steve Hilton"], "percentages": [61, 36]}]},
            {"pollster": "Primary only", "matchups": [{"candidates": ["Xavier Becerra"], "percentages": [40]}]},
        ],
        "forecast": {
            "rating": "safe_d",
            "win_probability": 0.95,
            "predicted_winner_name": "Xavier Becerra",
            "predicted_winner_party": "Democratic",
            "margin_estimate": 17.0,
            "takeaway": "Becerra holds an 18-point lead.",
            "rationale": "PPIC shows an 18-point lead.",
            "key_reasons": ["PPIC: 18 points."],
            "uncertainty": "A third of voters are undecided.",
            "evidence_lineage": [{"claim": "18-point lead", "source_url": "https://ppic.org/x"}],
            "panel": [{"model": "a"}, {"model": "b"}, {"model": "c"}],
        },
    }


def test_fallback_forecast_text_repeats_only_the_numbers():
    race = _forecast_race()
    assert replace_unverified_forecast_text(race) is True
    forecast = race["forecast"]
    prose = " ".join([forecast["takeaway"], forecast["rationale"], forecast["uncertainty"], *forecast["key_reasons"]])
    assert "18" not in prose and "third" not in prose
    assert forecast["takeaway"] == "Xavier Becerra (Democratic) is favored, with a 95% chance of winning."
    assert "Safe Democratic" in forecast["rationale"]
    assert "about 17 points" in forecast["rationale"]
    # Only the head-to-head poll counts; the primary-only one does not.
    assert forecast["based_on_poll_count"] == 1
    assert "1 public poll with a head-to-head matchup" in forecast["rationale"]
    assert forecast["key_reasons"][-1] == "Method: the median of 3 independent model estimates."
    assert forecast["evidence_lineage"] is None
    # The numbers are untouched.
    assert forecast["win_probability"] == 0.95 and forecast["rating"] == "safe_d"


def test_fallback_forecast_text_for_a_tossup_names_nobody():
    text = deterministic_forecast_text({"rating": "tossup", "win_probability": 0.51}, {"candidates": [], "polling": []})
    assert text["takeaway"] == "This race is rated a toss-up: neither side is clearly favored."
    assert "No head-to-head public poll" in text["rationale"]
    assert text["based_on_poll_count"] == 0


def test_fallback_forecast_text_validates_against_the_schema():
    from shared.models import RaceForecast

    race = _forecast_race()
    replace_unverified_forecast_text(race)
    forecast = {**race["forecast"], "generated_at": datetime.now(timezone.utc).isoformat(), "model": "m"}
    forecast.pop("panel")
    RaceForecast.model_validate(forecast)


# ---------------------------------------------------------------------------
# #9 Neutrality lint
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Miller is a far-right Republican and Freedom Caucus member.",
        "the fringe standing of the four third-party candidates",
        "a seat radically reshaped by redistricting",
        "Smith is an uncompromising defender of the Second Amendment.",
        "Boebert, a conservative firebrand, faces Thornton.",
        "a proxy battle between the socialist left and moderates",
        "the controversial Republican congressman",
        "MAGA extremists in the House blocked the bill.",
    ],
)
def test_loaded_wording_in_the_sites_voice_is_flagged(text):
    assert find_loaded_language(text), text


@pytest.mark.parametrize(
    "text",
    [
        # Quoted and attributed.
        'He opposes what he calls "radical transgender ideology" in schools.',
        "She would roll back what she calls “radical green regulations.”",
        "Smith described a campaign of intimidation by far-left activists.",
        "His campaign says he opposes communist, Marxist, and socialist ideologies.",
        # Party and organisation names.
        "Jacob Perasso (Socialist Workers) is also on the ballot.",
        "the Party for Socialism and Liberation nominee",
        "the Defeat Extremists PAC contributed $2,000.",
        # Self-identification and things that are not people.
        "Running as an independent socialist, his platform emphasizes public housing.",
        "Oklahoma's first openly democratic socialist Senate nominee",
        "a controversial mid-cycle redistricting plan",
        "He wants to keep guns from dangerous people.",
    ],
)
def test_attributed_quoted_and_named_wording_is_not_flagged(text):
    assert find_loaded_language(text) == [], text


def _graded_race(**overrides):
    race = {
        "id": "il-house-15-2026",
        "description": "Illinois's 15th District pits a far-right incumbent against a progressive challenger.",
        "candidates": [{"name": "Mary Miller", "party": "Republican", "voting_summary": "Miller is a far-right Republican."}],
    }
    race.update(overrides)
    return race


def test_neutrality_flags_point_at_the_field_and_are_warnings():
    flags = neutrality_flags(_graded_race())
    assert [flag["field"] for flag in flags] == ["description", "candidates[0].voting_summary"]
    assert all(flag["severity"] == "warning" and is_neutrality_flag(flag) for flag in flags)


def test_profile_quality_review_carries_neutrality_flags():
    review = check_profile_quality(_graded_race(), issues_step_ran=False)
    assert any(is_neutrality_flag(flag) for flag in review["flags"])


def _model_review(score=96, **extra):
    return {"model": "m", "verdict": "approved", "score": score, "flags": [], **extra}


def test_neutrality_warning_holds_the_grade_below_a():
    automated = {
        "model": "automated-profile-quality",
        "verdict": "flagged",
        "score": None,
        "flags": neutrality_flags(_graded_race()),
    }
    race = {"candidates": [{"issues": {"Economy": {"stance": "Cut taxes."}}}]}
    grade = compute_validation_grade([_model_review(98), automated], race)
    assert grade["grade"] == "B" and grade["passed"] is True
    assert grade["score"] <= NEUTRALITY_SCORE_CAP
    assert "loaded wording" in grade["summary"]


# ---------------------------------------------------------------------------
# #3 Stale reviews are visible in the grade
# ---------------------------------------------------------------------------


def test_grade_with_only_stale_reviews_says_so():
    reviews = [_model_review(94, stale=True), _model_review(94, stale=True), _model_review(94, stale=True)]
    grade = compute_validation_grade(reviews)
    assert grade["current_review_count"] == 0
    assert grade["stale_review_count"] == 3
    assert grade["summary"].startswith("Reviews are out of date")
    assert "Validated by 3/3" not in grade["summary"].split("Earlier result:")[0]
    ValidationGrade.model_validate(grade)


def test_grade_counts_only_current_reviews_when_some_are_current():
    reviews = [_model_review(70, stale=True), _model_review(92), _model_review(94)]
    grade = compute_validation_grade(reviews)
    assert grade["current_review_count"] == 2 and grade["stale_review_count"] == 1
    assert grade["score"] == 93
    assert "Validated by 2/2 reviewers" in grade["summary"]
    assert "1 older review(s)" in grade["summary"]


def test_grade_without_stale_reviews_reports_zero():
    grade = compute_validation_grade([_model_review(91)])
    assert grade["current_review_count"] == 1 and grade["stale_review_count"] == 0


def test_validation_grade_model_accepts_grades_without_the_new_counts():
    grade = ValidationGrade.model_validate({"grade": "A", "score": 94, "passed": True, "summary": "x"})
    assert grade.current_review_count is None and grade.stale_review_count is None


# ---------------------------------------------------------------------------
# #12 No-position variants and pipeline language
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stance",
    [
        "No publicly stated position on technology and artificial intelligence policy found.",
        "No public position on healthcare policy found. The candidate's campaign website and public materials do not "
        "address healthcare issues.",
        "No public stance published on Tech & AI by Eric Foreman's campaign. Current campaign materials and candidate "
        "profiles do not show a Tech & AI policy position.",
        "No public foreign policy position is stated on Stefany Shaheen's official campaign materials; the campaign's "
        "'Priorities' page focuses on domestic issues and does not address foreign policy.",
        "No detailed public position on technology or artificial intelligence policy was identified in the reviewed "
        "campaign materials, news coverage, or candidate questionnaires.",
        "No public position found.",
    ],
)
def test_no_position_variants_become_the_exact_marker(stance):
    assert normalize_no_position_stance(stance) == NO_POSITION_MARKER


@pytest.mark.parametrize(
    "stance",
    [
        # Opens with an absence, then reports something real: keep it.
        "No newer abortion-specific statement was identified after August 24, 2026. In a 2014 questionnaire, McDermott "
        "said he was personally pro-life.",
        "No specific public position on abortion or reproductive-health policy was found in the reviewed materials. In "
        "his 2026 Ballotpedia survey, Thibodeau said he is interested in making healthcare accessible.",
        "No detailed position on election administration was identified, but his campaign is endorsed by End Citizens "
        "United.",
        "No more tariffs: she opposes new import taxes.",
        "Supports expanding Medicare.",
        NO_POSITION_MARKER,
    ],
)
def test_stances_with_content_are_left_alone(stance):
    assert not is_no_position_variant(stance)
    assert normalize_no_position_stance(stance) == stance


@pytest.mark.parametrize(
    "before,after",
    [
        (
            "No 2026 data was found in the available search results.",
            "No 2026 data was found in available sources.",
        ),
        (
            "He has not held office according to the provided sources.",
            "He has not held office according to available sources.",
        ),
        (
            "Totals are not readily available in the provided search results.",
            "Totals are not readily available in available sources.",
        ),
        ("No polls found. Search results identified primary returns.", "No polls found. Sources identified primary returns."),
        ("VPAP lists her fundraising as N/A.", "VPAP lists her fundraising as not available."),
        ("Supports the N/A-free 24/7 plan.", "Supports the N/A-free 24/7 plan."),
    ],
)
def test_pipeline_language_is_rewritten(before, after):
    assert clean_pipeline_language(before) == after


def test_cleanup_normalizes_stances_and_prose():
    race = {
        "description": "Totals were not found in the provided search results.",
        "candidates": [
            {
                "name": "Jane Doe",
                "party": "Democratic Party",
                "donor_summary": "No 2026 data was found in the available search results.",
                "issues": {
                    "Healthcare": {"stance": "No public position on healthcare policy found.", "confidence": "medium"},
                    "Economy": {"stance": "Cuts taxes, per the provided sources.", "sources": [{"url": "https://a"}]},
                    "Local Issues": {"stance": "(to be updated)", "sources": [{"url": "https://b"}]},
                },
            }
        ],
    }
    report = cleanup_race_data(race)
    candidate = race["candidates"][0]
    assert race["description"] == "Totals were not found in available sources."
    assert candidate["donor_summary"] == "No 2026 data was found in available sources."
    assert candidate["issues"]["Healthcare"] == {"stance": NO_POSITION_MARKER, "confidence": "low"}
    assert candidate["issues"]["Economy"]["stance"] == "Cuts taxes, per available sources."
    assert "Local Issues" not in candidate["issues"]
    assert candidate["party"] == "Democratic"
    assert report["placeholder_fields_cleared"] == 1


def test_set_issue_stance_stores_the_marker_for_a_variant():
    from pipeline_client.agent.handlers import _make_editing_handlers

    race = {"id": "x-2026", "candidates": [{"name": "Jane Doe", "issues": {}}]}
    handlers = _make_editing_handlers(race, lambda *_a, **_k: None)
    result = handlers["set_issue_stance"](
        {
            "candidate_name": "Jane Doe",
            "issue": "Healthcare",
            "stance": "No public position on healthcare policy found.",
            "confidence": "medium",
            "sources": [],
        }
    )
    assert not str(result).startswith("ERROR"), result
    stored = race["candidates"][0]["issues"]["Healthcare"]
    assert stored["stance"] == NO_POSITION_MARKER and stored["confidence"] == "low"


def test_shared_prompt_rules_require_the_exact_marker_and_neutral_voice():
    from pipeline_client.agent.prompts import _SHARED_RULES

    assert '"No public position found"' in _SHARED_RULES
    assert "search results" in _SHARED_RULES and "far-right" in _SHARED_RULES


# ---------------------------------------------------------------------------
# #19 Placeholders count as empty
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["(to be updated)", "TBD", "[TODO]", "N/A", "n/a.", "  ", "To be updated."])
def test_placeholders_are_empty(value):
    from pipeline_client.agent.agent import _is_missing_stance_text
    from shared.race_catalog import _issue_verdict

    assert is_placeholder_text(value)
    assert _is_missing_stance_text(value)
    assert _issue_verdict({"stance": value, "sources": [{"url": "https://a"}]}) == (False, False, False)


@pytest.mark.parametrize("value", ["(to be updated)", "TBD", "N/A", "[TODO]"])
def test_placeholder_stances_register_as_placeholder_content(value):
    from shared.run_health import is_placeholder_junk_stance

    assert is_placeholder_junk_stance(value)


def test_real_stances_are_not_placeholders():
    assert not is_placeholder_text("To be updated annually, the minimum wage should track inflation.")
    assert not is_placeholder_text("None of the proposed reforms go far enough.")


# ---------------------------------------------------------------------------
# #18 Party labels
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label,expected",
    [
        ("Democratic Party", "Democratic"),
        ("Democrat", "Democratic"),
        ("democratic", "Democratic"),
        ("Republican Party", "Republican"),
        ("GOP", "Republican"),
        ("Constitution Party", "Constitution"),
        ("Libertarian Party", "Libertarian"),
        ("Green Party", "Green"),
        ("Working Class Party", "Working Class"),
        ("U.S. Taxpayers Party", "U.S. Taxpayers"),
        ("Legal Marijuana NOW", "Legal Marijuana Now"),
        ("Socialism and Liberation", "Party for Socialism and Liberation"),
        ("I", "Independent"),
        # Kept as written.
        ("Kentucky Party", "Kentucky Party"),
        ("Voice Party", "Voice Party"),
        ("No Political Party", "No Political Party"),
        ("No Party Affiliation", "No Party Affiliation"),
        ("Democratic-Farmer-Labor", "Democratic-Farmer-Labor"),
        ("Unenrolled", "Unenrolled"),
        (None, None),
    ],
)
def test_party_labels_are_normalized(label, expected):
    assert normalize_party(label) == expected


def test_discovery_roster_normalization_applies_party_labels():
    from pipeline_client.agent.roster import normalize_candidate_entries

    race = {"candidates": [{"name": "A", "party": "Republican Party"}, {"name": "B", "party": "Constitution Party"}]}
    normalize_candidate_entries(race)
    assert [c["party"] for c in race["candidates"]] == ["Republican", "Constitution"]
