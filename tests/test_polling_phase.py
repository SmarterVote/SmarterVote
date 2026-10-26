"""The polling phase must be offered the whole roster, not a run's research scope."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from pipeline_client.agent import wikipedia_polls
from pipeline_client.agent.phases.context import PhaseContext
from pipeline_client.agent.phases.polling import run_polling_phase

# Captured at import, before the autouse conftest fixture stubs the network fetch.
_REAL_FETCH = wikipedia_polls.fetch_wikipedia_wikitext

ROSTER = ["Michael Turner", "Kristina Knickerbocker", "Thomas McMasters"]


def _race():
    return {
        "id": "oh-house-10-2026",
        "candidates": [
            {"name": "Michael Turner", "party": "Republican"},
            {"name": "Kristina Knickerbocker", "party": "Democratic"},
            {"name": "Thomas McMasters", "party": "Libertarian"},
        ],
        "polling": [],
    }


def _ctx(race_json, scope):
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
        candidate_names=scope,
        selected_name_set=set(scope),
    )


async def _polling_prompt(scope):
    captured = {}

    async def fake(system, user, **_kwargs):
        captured["user"] = user
        return {}

    with patch("pipeline_client.agent.phases._agent_loop", new=fake):
        await run_polling_phase(_ctx(_race(), scope))
    return captured["user"]


@pytest.mark.asyncio
async def test_candidate_scoped_run_still_offers_polling_every_nominee():
    """A run scoped to one candidate must not hide the other nominees from polling.

    oh-house-10-2026 was re-researched for Thomas McMasters alone. The polling
    prompt was built from that one-name scope, so the model decided the real July
    2026 polls of Turner and Knickerbocker named candidates outside the race,
    rejected them, and the race lost both stored polls.
    """
    prompt = await _polling_prompt(["Thomas McMasters"])

    for name in ROSTER:
        assert name in prompt


@pytest.mark.asyncio
async def test_unscoped_run_offers_polling_the_same_roster():
    prompt = await _polling_prompt(ROSTER)

    for name in ROSTER:
        assert name in prompt


# ---------------------------------------------------------------------------
# Wikipedia poll-table reference context
# ---------------------------------------------------------------------------

TODAY = date(2026, 10, 26)
JACKSON_COLLINS = ["Graham Jackson", "Susan Collins"]
MAINE_PAGE_URL = "https://en.wikipedia.org/wiki/2026_United_States_Senate_election_in_Maine"
TRAFALGAR_PDF = "https://thetrafalgargroup.org/wp-content/uploads/2026/10/ME-Midterms-Report-1025.pdf"

MAINE_WIKITEXT = f"""\
'''The 2026 United States Senate election in Maine''' will be held on November 3, 2026.<ref name="trafalgar">\
{{{{cite web |url={TRAFALGAR_PDF} |title=Maine Midterms Report}}}}</ref>

== Republican primary ==
=== Polling ===
{{| class="wikitable"
|- valign=bottom
! Poll source
! Date(s)<br />administered
! Sample<br />size
! Susan<br />Collins
! Other
|-
| [[Pan Atlantic Research]]
|October 1–5, 2026
|400 (LV)
|80%
|20%
|}}

== General election ==
=== Predictions ===
Nothing here.

=== Polling ===
<!-- Add new polls at the top -->
{{| class="wikitable"
|- valign=bottom
! Source of poll aggregation
! Dates administered
! Graham Jackson (D)
! Susan Collins (R)
|-
| [[Decision Desk HQ]]
| October 20, 2026
| 46.0%
| 47.0%
|}}

{{| class="wikitable sortable"
|- valign=bottom
! Poll source
! Date(s)<br />administered
! Sample<br />size{{{{efn|Key: LV – likely voters}}}}
! Margin<br />of error
! style="width:100px;"| [[Graham Jackson|Graham<br />Jackson]] (D)
! style="width:100px;"| [[Susan Collins|Susan<br />Collins]] (R)
! Other
! Undecided
|-
| [[Trafalgar Group]] (R)<ref name="trafalgar" />
|October 21–23, 2026
|1,077 (LV)
|±{{{{nbsp}}}}2.9%
| style="background:#ddd"| '''47%'''
| style="background:#ddd"| '''47%'''
|3%
|3%
|-
| [[University of New Hampshire]]<ref>{{{{cite web |url=https://scholars.unh.edu/survey_center_polls/999 \
|title=UNH}}}}</ref>{{{{efn|name=MPA|Poll sponsored by the Maine People's Alliance}}}}
|September 28 – October 2, 2026
|812 (LV) || ±3.4% || {{{{party shading/Democratic}}}} |'''48%''' || 44% || 4% || 4%
|-
| [[Emerson College]]<ref>[https://emersoncollegepolling.com/maine-june-2026/ Emerson]</ref>
|June 10–12, 2026
|900 (RV)
|±3.2%
|45%
|'''46%'''
|5%
|4%
|}}

== Notes ==
{{{{notelist}}}}
"""

MAINE_RACE = {"id": "me-senate-2026", "state": "Maine", "candidates": [{"name": n} for n in JACKSON_COLLINS]}


def test_wikipedia_poll_table_parser_extracts_recent_head_to_head_rows():
    rows = wikipedia_polls.parse_wikipedia_poll_rows(MAINE_WIKITEXT, JACKSON_COLLINS, today=TODAY)

    # The June Emerson row is older than 45 days; the primary and aggregate tables are not general polls.
    assert [row["pollster"] for row in rows] == ["Trafalgar Group", "University of New Hampshire"]
    trafalgar, unh = rows
    assert trafalgar == {
        "pollster": "Trafalgar Group",
        "start_date": "2026-10-21",
        "date": "2026-10-23",
        "results": {"Graham Jackson": 47.0, "Susan Collins": 47.0},
        "sample_size": 1077,
        "population": "LV",
        "source_url": TRAFALGAR_PDF,
        # The "(R)" suffix is dropped from the name but kept as a partisan note.
        "note": "Wikipedia marks this poll as partisan: (R)",
    }
    assert (unh["start_date"], unh["date"]) == ("2026-09-28", "2026-10-02")
    assert unh["results"] == {"Graham Jackson": 48.0, "Susan Collins": 44.0}
    assert unh["sample_size"] == 812
    assert unh["source_url"] == "https://scholars.unh.edu/survey_center_polls/999"
    assert unh["note"] == "Poll sponsored by the Maine People's Alliance"


def test_wikipedia_poll_table_parser_caps_rows_and_needs_a_polling_section():
    capped = wikipedia_polls.parse_wikipedia_poll_rows(MAINE_WIKITEXT, JACKSON_COLLINS, today=TODAY, max_rows=1)

    assert [row["pollster"] for row in capped] == ["Trafalgar Group"]
    assert wikipedia_polls.parse_wikipedia_poll_rows("== General election ==\nNo polls.", JACKSON_COLLINS, today=TODAY) == []


@pytest.mark.parametrize(
    "race, title",
    [
        ({"id": "me-senate-2026", "state": "Maine"}, "2026 United States Senate election in Maine"),
        ({"id": "oh-senate-special-2026"}, "2026 United States Senate special election in Ohio"),
        ({"id": "ny-governor-2026"}, "2026 New York gubernatorial election"),
        ({"id": "oh-house-10-2026", "state": "Ohio"}, None),
        ({"id": "zz-senate-2026"}, None),
    ],
)
def test_wikipedia_poll_page_title(race, title):
    assert wikipedia_polls.wikipedia_poll_page_title(race) == title


@pytest.mark.asyncio
async def test_wikipedia_poll_fetch_failure_is_a_no_op():
    class FailingClient:
        def __init__(self, *_a, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def get(self, *_a, **_kw):
            raise httpx.ConnectTimeout("timed out")

    with (
        patch("pipeline_client.agent.wikipedia_polls.fetch_wikipedia_wikitext", new=_REAL_FETCH),
        patch("pipeline_client.agent.wikipedia_polls.httpx.AsyncClient", FailingClient),
    ):
        assert await wikipedia_polls.fetch_wikipedia_wikitext("2026 United States Senate election in Maine") is None
        assert await wikipedia_polls.wikipedia_poll_context(MAINE_RACE, JACKSON_COLLINS) == ""


@pytest.mark.asyncio
async def test_polling_prompt_includes_wrapped_wikipedia_rows():
    captured = {}

    async def fake(system, user, **_kwargs):
        captured["user"] = user
        return {}

    with (
        patch("pipeline_client.agent.wikipedia_polls.fetch_wikipedia_wikitext", new=AsyncMock(return_value=MAINE_WIKITEXT)),
        patch("pipeline_client.agent.wikipedia_polls._today", return_value=TODAY),
        patch("pipeline_client.agent.phases._agent_loop", new=fake),
    ):
        await run_polling_phase(_ctx({**MAINE_RACE, "polling": []}, JACKSON_COLLINS))

    prompt = captured["user"]
    assert "Wikipedia's general-election poll table (untrusted data" in prompt
    assert f'<untrusted_web_content source="{MAINE_PAGE_URL}">' in prompt
    assert "- Trafalgar Group | 2026-10-21 to 2026-10-23 | n=1077 LV | Graham Jackson 47%, Susan Collins 47%" in prompt
    assert f"source: {TRAFALGAR_PDF}" in prompt
    assert "note: Poll sponsored by the Maine People's Alliance" in prompt
    assert f"or {MAINE_PAGE_URL} when none is listed" in prompt
    assert "Emerson College" not in prompt


@pytest.mark.asyncio
async def test_polling_prompt_omits_wikipedia_block_without_rows():
    prompt = await _polling_prompt(ROSTER)

    assert "untrusted_web_content" not in prompt
