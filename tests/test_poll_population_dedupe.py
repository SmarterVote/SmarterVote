"""One survey released for several voter populations is stored once, likely voters first."""

from __future__ import annotations

from datetime import date

import pytest

from pipeline_client.agent import wikipedia_polls
from pipeline_client.agent.agent import _sanitize_polling
from pipeline_client.agent.handlers import _make_editing_handlers
from pipeline_client.agent.polling_quality import normalize_pollster_name, split_poll_population

ROSTER = ["Graham Jackson", "Susan Collins"]
BEACON = "Beacon Research/Shaw & Co. Research (for Fox News)"


def _poll(pollster, day, jackson, collins, sample_size=None):
    poll = {
        "pollster": pollster,
        "date": day,
        "matchups": [{"candidates": list(ROSTER), "percentages": [jackson, collins]}],
        "source_url": "https://example.com/poll",
    }
    if sample_size:
        poll["sample_size"] = sample_size
    return poll


def _race(*polls):
    return {
        "id": "me-senate-2026",
        "election_date": "2026-11-03",
        "candidates": [{"name": name} for name in ROSTER],
        "polling": list(polls),
    }


def test_production_lv_rv_pair_keeps_the_likely_voter_row():
    race = _race(
        _poll(f"{BEACON} (D), (R) — registered voters", "2026-10-20", 50, 48, 1689),
        _poll(f"{BEACON} (D), (R)", "2026-10-20", 49, 49, 1514),
    )

    _sanitize_polling(race)

    assert len(race["polling"]) == 1
    kept = race["polling"][0]
    assert kept["sample_size"] == 1514
    assert kept["matchups"][0]["percentages"] == [49, 49]
    # Neither the population label nor the bipartisan "(D), (R)" pair stays in the name.
    assert kept["pollster"] == BEACON


def test_explicit_lv_beats_rv_regardless_of_order():
    race = _race(
        _poll("Pan Atlantic Research (RV)", "2026-10-12", 47, 45, 900),
        _poll("Pan Atlantic Research (LV)", "2026-10-12", 48, 46, 700),
    )

    _sanitize_polling(race)

    assert [(p["pollster"], p["sample_size"]) for p in race["polling"]] == [("Pan Atlantic Research", 700)]


def test_registered_voter_poll_is_kept_when_no_likely_voter_version_exists():
    race = _race(_poll("Emerson College - registered voters", "2026-10-01", 45, 46, 900))

    _sanitize_polling(race)

    assert [(p["pollster"], p["sample_size"]) for p in race["polling"]] == [("Emerson College", 900)]


def test_same_pollster_on_different_dates_are_separate_surveys():
    race = _race(
        _poll("Pan Atlantic Research (LV)", "2026-10-12", 48, 46, 700),
        _poll("Pan Atlantic Research (RV)", "2026-09-14", 44, 47, 650),
    )

    _sanitize_polling(race)

    assert [(p["pollster"], p["date"]) for p in race["polling"]] == [
        ("Pan Atlantic Research", "2026-10-12"),
        ("Pan Atlantic Research", "2026-09-14"),
    ]


@pytest.mark.parametrize(
    "raw, name, population",
    [
        (f"{BEACON} (D), (R) — registered voters", f"{BEACON} (D), (R)", "RV"),
        ("Siena College (LV)", "Siena College", "LV"),
        ("Marist Poll, likely voters", "Marist Poll", "LV"),
        ("Gallup (adults)", "Gallup", "A"),
        ("Group A Strategies", "Group A Strategies", None),
    ],
)
def test_population_suffix_is_split_from_the_pollster(raw, name, population):
    assert split_poll_population(raw) == (name, population)


def test_single_party_mark_stays_and_bipartisan_pair_goes():
    assert normalize_pollster_name("Trafalgar Group (R)") == "Trafalgar Group (R)"
    assert normalize_pollster_name("Public Policy Polling (D) (RV)") == "Public Policy Polling (D)"
    assert normalize_pollster_name(f"{BEACON} (R), (D)") == BEACON
    assert normalize_pollster_name("Beacon Research (D)/Shaw & Co. Research (R)") == "Beacon Research/Shaw & Co. Research"


def test_add_poll_lets_a_likely_voter_release_replace_its_registered_voter_twin():
    race = _race()
    handlers = _make_editing_handlers(race, lambda *_a, **_k: None)

    handlers["add_poll"](_poll(f"{BEACON} (D), (R) — registered voters", "2026-10-20", 50, 48, 1689))
    assert [p["pollster"] for p in race["polling"]] == [BEACON]

    result = handlers["add_poll"](_poll(f"{BEACON} (LV)", "2026-10-20", 49, 49, 1514))

    assert result.startswith("Replaced")
    assert [(p["pollster"], p["sample_size"]) for p in race["polling"]] == [(BEACON, 1514)]


def test_add_poll_skips_a_registered_voter_twin_of_a_stored_poll():
    race = _race()
    handlers = _make_editing_handlers(race, lambda *_a, **_k: None)
    handlers["add_poll"](_poll(BEACON, "2026-10-20", 49, 49, 1514))

    result = handlers["add_poll"](_poll(f"{BEACON} — registered voters", "2026-10-20", 50, 48, 1689))

    assert "skipping duplicate" in result
    assert [(p["pollster"], p["sample_size"]) for p in race["polling"]] == [(BEACON, 1514)]


WIKITEXT = """\
== General election ==
=== Polling ===
{| class="wikitable sortable"
|- valign=bottom
! Poll source
! Date(s)<br />administered
! Sample<br />size
! [[Graham Jackson|Graham<br />Jackson]] (D)
! [[Susan Collins|Susan<br />Collins]] (R)
|-
| [[Beacon Research]] (D)/[[Shaw & Company Research|Shaw & Co. Research]] (R){{efn|name=Fox|Poll sponsored by Fox News}}
|October 17–20, 2026
|1,689 (RV)
|50%
|48%
|-
| [[Beacon Research]] (D)/[[Shaw & Company Research|Shaw & Co. Research]] (R){{efn|name=Fox|Poll sponsored by Fox News}}
|October 18–20, 2026
|1,514 (LV)
|49%
|49%
|-
| [[Trafalgar Group]] (R)
|October 21–23, 2026
|1,077 (LV)
|47%
|47%
|-
| [[Beacon Research]] (D)/[[Shaw & Company Research|Shaw & Co. Research]] (R)
|September 20–23, 2026
|1,200 (RV)
|47%
|47%
|}
"""


def test_wikipedia_rows_keep_likely_voters_and_treat_a_bipartisan_team_as_neutral():
    rows = wikipedia_polls.parse_wikipedia_poll_rows(WIKITEXT, ROSTER, today=date(2026, 10, 27))

    assert [(r["pollster"], r["date"], r.get("population")) for r in rows] == [
        ("Trafalgar Group", "2026-10-23", "LV"),
        ("Beacon Research/Shaw & Co. Research", "2026-10-20", "LV"),
        ("Beacon Research/Shaw & Co. Research", "2026-09-23", "RV"),
    ]
    trafalgar, beacon, older_beacon = rows
    assert trafalgar["note"] == "Wikipedia marks this poll as partisan: (R)"
    assert beacon["sample_size"] == 1514
    assert "partisan:" not in beacon["note"]
    assert "bipartisan pollster team" in beacon["note"]
    assert older_beacon["note"] == "Wikipedia marks this as a bipartisan pollster team"
    assert not any(r["pollster"].endswith(("(D), (R)", "(R)", "(D)")) for r in rows)
