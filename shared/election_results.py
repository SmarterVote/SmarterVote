"""Checks every election result must pass before it is stored or published.

A wrong winner is the worst error this site can make, so these rules are code
rather than prompt text. The pipeline's ``record_race_result`` tool and the
results-only publish endpoint both call :func:`validate_race_result`.
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

GENERAL_ELECTION_DATE = "2026-11-03"

RESULT_STATUSES = frozenset(
    {"not_yet_reported", "counting", "too_close", "called", "runoff_required", "rcv_pending", "certified", "unopposed"}
)
#: Statuses that name a winner.
WINNER_STATUSES = frozenset({"called", "certified", "unopposed"})
#: Statuses that report a count. A prompt asking for counts was not enough: the
#: replay returned called races with no counts at all, so the check is here.
COUNTED_STATUSES = frozenset({"counting", "too_close", "called", "runoff_required", "rcv_pending", "certified"})
#: Steps that would rewrite the pre-election record once voting has ended.
FROZEN_POST_ELECTION_STEPS = frozenset({"discovery", "polling", "forecast"})

_ALLOW_POST_ELECTION_ENV = "PIPELINE_ALLOW_POST_ELECTION_STEPS"

# Latest statewide poll close on 2026-11-03, in UTC hours after midnight Nov 3
# (Eastern is UTC-5 on Election Day, so 25 is 8 p.m. ET). Source:
# https://www.270towin.com/poll-closing-times/ using each state's last zone.
_LATEST_POLL_CLOSE_UTC_HOUR: Dict[str, float] = {
    **dict.fromkeys(["Georgia", "Indiana", "Kentucky", "South Carolina", "Vermont", "Virginia"], 24),
    **dict.fromkeys(["North Carolina", "Ohio", "West Virginia"], 24.5),
    **dict.fromkeys(
        [
            "Alabama",
            "Connecticut",
            "Delaware",
            "District of Columbia",
            "Florida",
            "Illinois",
            "Maine",
            "Maryland",
            "Massachusetts",
            "Mississippi",
            "Missouri",
            "New Hampshire",
            "New Jersey",
            "Oklahoma",
            "Pennsylvania",
            "Rhode Island",
            "Tennessee",
        ],
        25,
    ),
    "Arkansas": 25.5,
    **dict.fromkeys(
        [
            "Arizona",
            "Colorado",
            "Iowa",
            "Kansas",
            "Louisiana",
            "Michigan",
            "Minnesota",
            "Nebraska",
            "New Mexico",
            "New York",
            "North Dakota",
            "South Dakota",
            "Texas",
            "Wisconsin",
            "Wyoming",
        ],
        26,
    ),
    **dict.fromkeys(["Montana", "Nevada", "Utah"], 27),
    **dict.fromkeys(["California", "Idaho", "Oregon", "Washington"], 28),
    "Hawaii": 29,
    "Alaska": 30,
}
_UNKNOWN_STATE_POLL_CLOSE_UTC_HOUR = 30


def poll_close_utc(state: Optional[str], election_date: str = GENERAL_ELECTION_DATE) -> datetime:
    """When the last polls in *state* close; unknown states use the last close nationally."""
    hour = _LATEST_POLL_CLOSE_UTC_HOUR.get(str(state or "").strip(), _UNKNOWN_STATE_POLL_CLOSE_UTC_HOUR)
    start = datetime.combine(date.fromisoformat(election_date[:10]), datetime.min.time(), tzinfo=timezone.utc)
    return start + timedelta(hours=hour)


def post_election_frozen_steps(race: Dict[str, Any], now: Optional[datetime] = None) -> frozenset[str]:
    """Steps to refuse for this race because its polls have closed."""
    if os.getenv(_ALLOW_POST_ELECTION_ENV, "").lower() in ("1", "true", "yes"):
        return frozenset()
    if str(race.get("election_date") or "")[:10] != GENERAL_ELECTION_DATE:
        return frozenset()
    current = now or datetime.now(timezone.utc)
    return FROZEN_POST_ELECTION_STEPS if current >= poll_close_utc(race.get("state")) else frozenset()


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _source_domain(url: Any) -> str:
    host = (urlparse(str(url or "")).hostname or "").casefold().removeprefix("www.")
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _roster_names(race: Dict[str, Any]) -> set[str]:
    return {
        str(candidate.get("name") or "").strip().casefold()
        for candidate in race.get("candidates") or []
        if isinstance(candidate, dict) and candidate.get("name")
    }


def validate_race_result(
    result: Dict[str, Any],
    race: Dict[str, Any],
    *,
    previous: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> List[str]:
    """Return every reason *result* must not be stored; an empty list means it passes."""
    current = now or datetime.now(timezone.utc)
    errors: List[str] = []
    status = result.get("status")
    if status not in RESULT_STATUSES:
        return [f"Unknown result status {status!r}"]

    election_date = str(race.get("election_date") or GENERAL_ELECTION_DATE)[:10]
    closes_at = poll_close_utc(race.get("state"), election_date)
    if current < closes_at and status != "not_yet_reported":
        errors.append(f"Polls in {race.get('state') or 'this state'} do not close until {closes_at.isoformat()}")

    sources = [source for source in result.get("sources") or [] if isinstance(source, dict)]
    earliest = date.fromisoformat(election_date)
    for source in sources:
        published = _parse_datetime(source.get("published_at"))
        if published and published.date() < earliest:
            errors.append(f"Source {source.get('url')} predates the election and may describe a primary")

    if status != "not_yet_reported" and not sources:
        errors.append("A result needs at least one source")

    roster = _roster_names(race)
    winner = str(result.get("winner_name") or "").strip()
    if status in WINNER_STATUSES:
        if not winner:
            errors.append(f"Status {status} needs winner_name")
        elif winner.casefold() not in roster:
            errors.append(f"Winner {winner!r} is not on the race roster")
    elif winner:
        errors.append(f"Status {status} must not name a winner")

    if status == "called":
        if not str(result.get("called_by") or "").strip():
            errors.append("A called race must name who called it")
        if _parse_datetime(result.get("called_at")) is None:
            errors.append("A called race needs called_at")
        qualifying = {
            _source_domain(source.get("url")) for source in sources if source.get("type") in {"government", "news"}
        } - {""}
        if len(qualifying) < 2:
            errors.append("A called race needs government or news sources from two independent domains")
    if status == "certified" and not any(source.get("type") == "government" for source in sources):
        errors.append("A certified result needs an official government source")
    if status == "unopposed" and len(roster) != 1:
        errors.append("Only a race with one candidate on the roster can be unopposed")
    if status == "runoff_required":
        runoff = str(result.get("runoff_date") or "")[:10]
        if not runoff or runoff <= election_date:
            errors.append("A runoff needs a runoff_date after the election")

    counted = {
        str(row.get("name") or "").strip().casefold()
        for row in result.get("candidates") or []
        if isinstance(row, dict) and (row.get("votes") is not None or row.get("pct") is not None)
    }
    if status in COUNTED_STATUSES and not counted:
        errors.append(f"Status {status} needs votes or pct for the candidates the sources report")
    elif status in WINNER_STATUSES & COUNTED_STATUSES and winner and winner.casefold() not in counted:
        errors.append(f"The winner {winner!r} needs votes or pct")

    if result.get("as_of") and _parse_datetime(result.get("as_of")) is None:
        errors.append("as_of is not a valid timestamp")
    reporting = result.get("pct_reporting")
    if reporting is not None and not 0 <= reporting <= 100:
        errors.append("pct_reporting must be between 0 and 100")

    total_pct = 0.0
    for row in result.get("candidates") or []:
        name = str(row.get("name") or "").strip()
        if name.casefold() not in roster:
            errors.append(f"Result row {name!r} is not on the race roster")
        votes = row.get("votes")
        pct = row.get("pct")
        if votes is not None and votes < 0:
            errors.append(f"Votes for {name!r} cannot be negative")
        if pct is not None:
            if not 0 <= pct <= 100:
                errors.append(f"Vote share for {name!r} must be between 0 and 100")
            total_pct += pct
    if total_pct > 100.5:
        errors.append(f"Vote shares total {total_pct:.1f}%")

    errors.extend(_dropped_candidate_errors(result, previous))
    errors.extend(_regression_errors(result, previous))
    return errors


def _counted_names(result: Optional[Dict[str, Any]]) -> Dict[str, str]:
    return {
        str(row.get("name") or "").strip().casefold(): str(row.get("name") or "").strip()
        for row in (result or {}).get("candidates") or []
        if isinstance(row, dict) and (row.get("votes") is not None or row.get("pct") is not None)
    }


def _dropped_candidate_errors(result: Dict[str, Any], previous: Optional[Dict[str, Any]]) -> List[str]:
    """A count may change, but a candidate it covered must not vanish from the next one.

    When the read check rejected one candidate's share, the model kept the other
    row alone and that passed: the lone candidate then showed as the leader
    (tn-house-09: Taylor only; tx-house-09: Gutierrez only). A correction_note
    does not excuse this, because the note explains a changed count, not a
    missing one.
    """
    if not isinstance(previous, dict) or result.get("status") not in COUNTED_STATUSES:
        return []
    counted = _counted_names(result)
    if not counted:
        return []  # the missing-counts error already covers an empty result
    missing = [name for key, name in _counted_names(previous).items() if key not in counted]
    if not missing:
        return []
    return [
        "The previous count covered "
        + ", ".join(repr(name) for name in missing)
        + "; give votes or pct for them as well, copied from a source, rather than dropping them"
    ]


def _regression_errors(result: Dict[str, Any], previous: Optional[Dict[str, Any]]) -> List[str]:
    """A published call or count moving backward needs a stated reason and a person's review."""
    if not isinstance(previous, dict) or str(result.get("correction_note") or "").strip():
        return []
    errors: List[str] = []
    old_status = previous.get("status")
    old_winner = str(previous.get("winner_name") or "").strip().casefold()
    new_winner = str(result.get("winner_name") or "").strip().casefold()
    if old_status in WINNER_STATUSES and result.get("status") not in WINNER_STATUSES:
        errors.append(f"Status moved backward from {old_status} without a correction_note")
    if old_status == "certified" and result.get("status") != "certified":
        errors.append("A certified result changed without a correction_note")
    if old_winner and new_winner and old_winner != new_winner:
        errors.append("The winner changed without a correction_note")
    old_votes = {str(row.get("name") or "").casefold(): row.get("votes") for row in previous.get("candidates") or []}
    for row in result.get("candidates") or []:
        before = old_votes.get(str(row.get("name") or "").casefold())
        after = row.get("votes")
        if isinstance(before, int) and isinstance(after, int) and after < before:
            errors.append(f"Votes for {row.get('name')!r} fell from {before} to {after} without a correction_note")
    return errors


def _number_patterns(row: Dict[str, Any]) -> List[tuple[str, "re.Pattern[str]"]]:
    patterns: List[tuple[str, "re.Pattern[str]"]] = []
    votes = row.get("votes")
    if isinstance(votes, int):
        forms = "|".join(re.escape(form) for form in {f"{votes:,}", str(votes)})
        patterns.append((f"{votes:,} votes", re.compile(rf"(?<![\d,.])(?:{forms})(?![\d,]*\d)")))
    pct = row.get("pct")
    if isinstance(pct, (int, float)):
        forms = {f"{pct:.1f}", f"{pct:g}"}
        if float(pct).is_integer():
            forms.add(str(int(pct)))
        alternatives = "|".join(re.escape(form) for form in forms)
        patterns.append((f"{pct:g}%", re.compile(rf"(?<![\d.])(?:{alternatives})\s*(?:%|percent|pct)", re.I)))
    return patterns


def unread_counts(result: Dict[str, Any], texts: List[str]) -> List[str]:
    """Counts in *result* that appear in none of *texts*. The model must copy a count, never estimate one."""
    corpus = "\n".join(texts)
    missing: List[str] = []
    for row in result.get("candidates") or []:
        if not isinstance(row, dict):
            continue
        for label, pattern in _number_patterns(row):
            if not pattern.search(corpus):
                missing.append(f"{row.get('name')}: {label}")
    return missing


def result_index_entry(race_id: str, race: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The compact public row for one race; sources stay on the race file except the top two."""
    result = race.get("result")
    if not isinstance(result, dict):
        return None
    images = {
        str(candidate.get("name") or "").casefold(): candidate.get("image_url")
        for candidate in race.get("candidates") or []
        if isinstance(candidate, dict)
    }
    return {
        "id": race_id,
        "title": race.get("title"),
        "status": result.get("status"),
        "winner_name": result.get("winner_name"),
        "winner_party": result.get("winner_party"),
        "called_by": result.get("called_by"),
        "called_at": result.get("called_at"),
        "pct_reporting": result.get("pct_reporting"),
        "runoff_date": result.get("runoff_date"),
        "as_of": result.get("as_of"),
        "candidates": [
            {**row, "image_url": images.get(str(row.get("name") or "").casefold())}
            for row in result.get("candidates") or []
            if isinstance(row, dict)
        ],
        "sources": [
            {"url": source.get("url"), "title": source.get("title")}
            for source in (result.get("sources") or [])[:2]
            if isinstance(source, dict)
        ],
    }
