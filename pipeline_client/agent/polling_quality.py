"""Deterministic semantic checks for race polling entries."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

_PLACEHOLDER_POLLSTERS = {
    "example",
    "example poll",
    "unknown",
    "unknown pollster",
    "n/a",
    "none",
    "poll",
}
_ELECTION_RESULT_URL_MARKERS = (
    "electionresults.",
    "/election-results",
    "/elections/results",
    "/primary-election-results",
    "/results-",
    "/returns/",
)
# A straw poll is a self-selected tally, not a sample. The Iowa State Fair's
# corn-kernel poll was stored for IA-02 and IA-03 as "Iowa Secretary of State"
# at 70-30, dragging both forecasts, and a run goal forbidding straw polls did
# not keep it out.
_STRAW_POLL_MARKERS = ("straw poll", "straw-poll", "straw_poll", "strawpoll")


def polling_semantic_problem(poll: Any, polling_note: Any = None) -> Optional[str]:
    """Return a publication-blocking reason when an entry is not an opinion poll."""
    if not isinstance(poll, dict):
        return "Polling entry is not an object."

    pollster = str(poll.get("pollster") or "").strip()
    if not pollster or pollster.casefold() in _PLACEHOLDER_POLLSTERS:
        return f"Pollster name {pollster!r} is missing or a placeholder."

    has_numeric_matchup = any(
        isinstance(matchup, dict) and bool(matchup.get("percentages")) for matchup in poll.get("matchups") or []
    )
    if not has_numeric_matchup:
        return None

    source_url = str(poll.get("source_url") or "").casefold()
    note = str(polling_note or "").casefold()
    if any(marker in source_url for marker in _ELECTION_RESULT_URL_MARKERS):
        return "Election returns or candidate vote totals cannot be stored as opinion polling."
    if any(marker in f"{pollster.casefold()} {source_url}" for marker in _STRAW_POLL_MARKERS):
        return "A straw poll is a self-selected tally, not an opinion poll of a sample."
    if "primary result" in note or "election result" in note:
        return "The polling note identifies this numeric entry as election results rather than an opinion poll."
    return None


# --- Same-survey normalization -------------------------------------------------
#
# A pollster that releases both a likely-voter and a registered-voter topline for one
# survey was stored twice in me-senate-2026, the second as "Beacon Research/Shaw & Co.
# Research (for Fox News) (D), (R) - registered voters". PollEntry has no population
# field, so the label is read off the name, used to pick one row per survey, and dropped.

_POPULATION_CODES = {
    "likely voters": "LV",
    "likely voter": "LV",
    "lv": "LV",
    "registered voters": "RV",
    "registered voter": "RV",
    "rv": "RV",
    "all adults": "A",
    "adults": "A",
    "a": "A",
}
# An unlabeled entry ranks just behind an explicit likely-voter one: the agent tags only the
# secondary variant (the me-senate-2026 LV row was stored bare beside "- registered voters"),
# and a stored entry has already lost its label, so it must not lose to a later RV re-add.
_POPULATION_RANK = {"LV": 0, "RV": 2, "A": 3}
_UNKNOWN_POPULATION_RANK = 1
_POP_WORDS = r"likely\s+voters?|registered\s+voters?|all\s+adults|adults"
_BRACKETED_POPULATION_RE = re.compile(rf"\s*[(\[]\s*(?:among\s+)?({_POP_WORDS}|lv|rv|a)\s*[)\]]", re.IGNORECASE)
_TRAILING_POPULATION_RE = re.compile(rf"\s*(?:[\u2014\u2013-]+|,|:)\s*(?:among\s+)?({_POP_WORDS}|lv|rv)\s*$", re.IGNORECASE)
_PARTY_MARK_RE = re.compile(r"\s*\((D|R)\)")


def split_poll_population(pollster: Any) -> Tuple[str, Optional[str]]:
    """Return ``(pollster without population labels, "LV"/"RV"/"A" or None)``."""
    name = str(pollster or "").strip()
    population: Optional[str] = None
    for pattern in (_BRACKETED_POPULATION_RE, _TRAILING_POPULATION_RE):
        while True:
            match = pattern.search(name)
            if not match:
                break
            code = _POPULATION_CODES.get(re.sub(r"\s+", " ", match.group(1).lower()))
            population = population or code
            name = (name[: match.start()] + name[match.end() :]).strip()
    return name, population


def strip_bipartisan_marks(pollster: Any) -> str:
    """Drop "(D)"/"(R)" marks when a pollster team carries both: bipartisan, not partisan."""
    name = str(pollster or "").strip()
    if set(_PARTY_MARK_RE.findall(name)) != {"D", "R"}:
        return name
    name = _PARTY_MARK_RE.sub("", name)
    name = re.sub(r"\s*/\s*", "/", name)
    return re.sub(r"(?:\s*,)+\s*$", "", re.sub(r"\s*,(?:\s*,)+", ",", name)).strip()


def normalize_pollster_name(pollster: Any) -> str:
    """Pollster name as stored: no population label and no bipartisan "(D), (R)" pair."""
    return strip_bipartisan_marks(split_poll_population(pollster)[0])


def poll_population_rank(pollster: Any) -> int:
    """Lower is preferred: likely voters, unlabeled (headline) toplines, registered voters, adults."""
    population = split_poll_population(pollster)[1]
    return _POPULATION_RANK.get(population or "", _UNKNOWN_POPULATION_RANK)


def same_survey_key(poll: Any) -> Optional[Tuple[str, str]]:
    """Identify one survey across its population variants: normalized pollster + end date."""
    if not isinstance(poll, dict):
        return None
    name = _PARTY_MARK_RE.sub("", split_poll_population(poll.get("pollster"))[0])
    name = re.sub(r"[^a-z0-9]+", "", name.casefold())
    date = str(poll.get("date") or "").strip()[:10]
    if not name or not date:
        return None
    return name, date


def dedupe_same_survey_polls(polls: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Keep one entry per survey (LV > unlabeled > RV > adults) and normalize pollster names.

    Returns the kept polls, in their original order, and the pollster labels removed.
    """
    best: Dict[Tuple[str, str], int] = {}
    for index, poll in enumerate(polls):
        key = same_survey_key(poll)
        if key is None:
            continue
        current = best.get(key)
        if current is None or poll_population_rank(poll.get("pollster")) < poll_population_rank(
            polls[current].get("pollster")
        ):
            best[key] = index
    kept: List[Dict[str, Any]] = []
    removed: List[str] = []
    for index, poll in enumerate(polls):
        key = same_survey_key(poll)
        if key is not None and best[key] != index:
            removed.append(str(poll.get("pollster") or ""))
            continue
        if isinstance(poll, dict) and isinstance(poll.get("pollster"), str):
            normalized = normalize_pollster_name(poll["pollster"])
            if normalized:
                poll["pollster"] = normalized
        kept.append(poll)
    return kept, removed
