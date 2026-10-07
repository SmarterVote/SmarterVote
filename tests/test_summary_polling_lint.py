"""Candidate summaries are biographies: the polling lint and the prompts that enforce it."""

from __future__ import annotations

import pytest

from pipeline_client.agent import prompts
from shared.text_quality import find_summary_polling_content, summary_contains_polling


@pytest.mark.parametrize(
    "text",
    [
        "Smith is a former mayor. A CNN/SSRS poll showed him at 47%.",
        "She leads 48%-44% in recent public surveys.",
        "Jones trails Smith 41 to 45 among likely voters.",
        "A survey of likely voters found her narrowly ahead.",
        "A survey released in September put him at 44 percent.",
        "His approval rating stood at 41% in September.",
        "Pollsters rate the race a toss-up.",
        "Recent polling shows a close contest.",
        "She is ahead 47-42 in the latest Emerson release.",
    ],
)
def test_lint_flags_poll_content(text):
    assert summary_contains_polling(text)
    assert find_summary_polling_content(text)


@pytest.mark.parametrize(
    "text",
    [
        "He won the primary with 77% of the vote.",
        "She won re-election in 2024 with 55 percent of the vote, defeating Smith 55-45.",
        "He worked for the U.S. Geological Survey for a decade before entering politics.",
        "She served as a poll worker and later as county clerk.",
        "He led the effort to pass the bill 52-48.",
        "A former state senator, she chairs the appropriations committee.",
        "He opened a new polling place for rural voters as county auditor.",
        "His campaign emphasizes ending PAC money and voting based on verified constituent polling.",
        "",
    ],
)
def test_lint_ignores_biography_and_election_results(text):
    assert not summary_contains_polling(text)
    assert find_summary_polling_content(text) == []


def test_lint_returns_only_the_offending_sentence():
    text = "Hill is a three-term congressman. He won the primary with 80% of the vote. A Talk Business poll had him up 12."
    assert find_summary_polling_content(text) == ["A Talk Business poll had him up 12."]


def test_lint_tolerates_non_strings():
    assert summary_contains_polling(None) is False
    assert find_summary_polling_content(42) == []


SUMMARY_PROMPTS = {
    "DISCOVERY_USER": prompts.DISCOVERY_USER,
    "REFINE_USER": prompts.REFINE_USER,
    "UPDATE_META_USER": prompts.UPDATE_META_USER,
    "ITERATE_USER": prompts.ITERATE_USER,
}


@pytest.mark.parametrize("name", sorted(SUMMARY_PROMPTS))
def test_every_summary_writing_prompt_carries_the_shared_balance_rules(name):
    template = SUMMARY_PROMPTS[name]
    assert prompts.SUMMARY_BALANCE_RULES in template
    assert "@@SUMMARY_BALANCE@@" not in template


def test_balance_rules_require_rewriting_non_compliant_legacy_summaries():
    rules = prompts.SUMMARY_BALANCE_RULES
    assert "MUST" in rules and "even when nothing new has happened" in rules
    assert "endorsement tallies" in rules
    assert "{" not in rules and "}" not in rules  # safe inside str.format templates


def test_update_prompt_no_longer_preserves_non_compliant_summaries():
    result = prompts.UPDATE_META_USER.format(
        race_id="oh-senate-2026", last_updated="2026-09-01", current_date="2026-10-07", candidate_names="A, B"
    )
    assert "A summary\n  that breaks SUMMARY BALANCE is a substantive reason: rewrite it." in result
    assert "(new events only)" not in result


def test_forecast_writer_is_told_not_to_label_polls_partisan():
    assert "Republican-leaning" in prompts.FORECAST_SYSTEM
    assert "campaign-sponsored poll" in prompts.FORECAST_SYSTEM
