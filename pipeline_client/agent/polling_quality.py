"""Deterministic semantic checks for race polling entries."""

from __future__ import annotations

import copy
import re
from datetime import date as _date
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

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
    name = re.sub(r"/{2,}", "/", name)
    name = re.sub(r"(?:\s*,)+\s*$", "", re.sub(r"\s*,(?:\s*,)+", ",", name)).strip()
    # A mark that stood alone after a separator ("Firm A (R) / (D)") leaves it dangling.
    return re.sub(r"^[\s,/]+|[\s,/]+$", "", name)


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


# --- Baseline poll guard -------------------------------------------------------
#
# A polling refresh dropped distinct surveys that were already stored: ks-senate-2026 lost
# InsiderAdvantage 2026-10-10 beside its 2026-10-14 release (and earlier NYT/Siena
# 2026-09-30), and ne-governor-2026 lost NPA Polling 2026-10-05 beside its 2026-10-18
# release. remove_poll offered "superseded by newer poll" as an example reason, and a
# pollster-only call removed every survey by that pollster. A newer poll does not void an
# older one (the forecast weights recency itself), so every distinct valid survey stays.

# Comparatives ("newer", "latest", "older") only count when they describe another
# poll, so "the latest topline in this entry is malformed" is not a recency claim.
_RECENCY_REMOVAL_RE = re.compile(
    r"\b(?:supersed\w*|outdated|out[\s-]of[\s-]date|stale|replaced\s+by|"
    r"(?:old|older|newer|more\s+recent|most\s+recent|latest|earlier)\s+(?:[\w/&.()-]+\s+){0,2}?"
    r"(?:polls?|surveys?|releases?|waves?|data))\b",
    re.IGNORECASE,
)
_DUPLICATE_REMOVAL_RE = re.compile(r"\b(?:duplicat\w*|redundant|repeat(?:ed)?|same\s+(?:poll|survey))\b", re.IGNORECASE)
NEAR_DATE_DUPLICATE_DAYS = 3


def is_recency_removal_reason(reason: Any) -> bool:
    """True when a removal reason only says the poll is older than another one.

    A duplicate claim ("duplicate of the newer release") is not a recency claim:
    remove_poll verifies it against the stored polls instead of refusing it.
    """
    text = str(reason or "")
    if is_duplicate_removal_reason(text):
        return False
    return bool(_RECENCY_REMOVAL_RE.search(text))


def is_duplicate_removal_reason(reason: Any) -> bool:
    """True when a removal reason claims the entry duplicates another stored entry."""
    return bool(_DUPLICATE_REMOVAL_RE.search(str(reason or "")))


def _poll_date(poll: Dict[str, Any]) -> Optional[_date]:
    try:
        return datetime.fromisoformat(str(poll.get("date") or "").strip()[:10]).date()
    except ValueError:
        return None


def _canonical_matchups(poll: Dict[str, Any]) -> Tuple[Tuple[Tuple[str, Any], ...], ...]:
    canonical = []
    for matchup in poll.get("matchups") or []:
        if not isinstance(matchup, dict):
            continue
        names = matchup.get("candidates") or []
        percentages = matchup.get("percentages") or []
        if isinstance(names, list) and isinstance(percentages, list):
            canonical.append(tuple(sorted(zip((str(name).strip() for name in names), percentages), key=str)))
    return tuple(sorted(canonical, key=str))


# Pages that list many polls: a shared URL on one of these says nothing about
# whether two entries are the same survey.
_POLL_AGGREGATOR_HOSTS = (
    "wikipedia.org",
    "ballotpedia.org",
    "realclearpolitics.com",
    "realclearpolling.com",
    "270towin.com",
    "fivethirtyeight.com",
    "abcnews.go.com",
    "racetothewh.com",
    "decisiondeskhq.com",
    "natesilver.net",
    "silverbulletin.com",
    "pollingreport.com",
    "electionpolls.com",
    "votehub.com",
    "split-ticket.org",
)
_POLL_LISTING_PATH_RE = re.compile(
    r"(?:^|/)(?:polls?|polling|latest[-_]polls?|poll[-_]tracker|polling[-_]averages?|poll[-_]averages?)$",
    re.IGNORECASE,
)


def _is_poll_listing_url(url: str) -> bool:
    """True for an aggregator, Wikipedia, or poll-listing page that hosts many surveys."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return True
    host = (parsed.hostname or "").lower()
    if any(host == root or host.endswith("." + root) for root in _POLL_AGGREGATOR_HOSTS):
        return True
    return bool(_POLL_LISTING_PATH_RE.search(parsed.path.rstrip("/") or "/x"))


def _pollsters_compatible(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    """Same firm, allowing a sponsor or party-mark relabel ("Emerson" vs "Emerson College/The Hill")."""
    left_key, right_key = same_survey_key(left), same_survey_key(right)
    if left_key is None or right_key is None:
        return False
    a, b = left_key[0], right_key[0]
    return a == b or a in b or b in a


def is_same_poll(left: Any, right: Any) -> bool:
    """Whether two entries record one survey, allowing a relabeled pollster.

    Same survey: normalized pollster + end date (``same_survey_key``); or, within
    ``NEAR_DATE_DUPLICATE_DAYS``, one source URL or the identical topline and sample size
    that ``_sanitize_polling`` already collapses (a sponsor relabel, or release date vs
    field end date).

    A shared source URL only identifies a survey when it is a single-poll page from
    compatible pollsters: Wikipedia and aggregator tables list many distinct polls under
    one URL, and counting those as one survey let a refresh drop baseline polls.

    Also the same survey: a differently spelled label for the same firm with the exact
    topline within ``RELABELED_SURVEY_DAYS`` (``is_relabeled_same_survey``).
    """
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    left_key = same_survey_key(left)
    if left_key is not None and left_key == same_survey_key(right):
        return True
    if is_relabeled_same_survey(left, right):
        return True
    left_date, right_date = _poll_date(left), _poll_date(right)
    if left_date is None or right_date is None or abs((left_date - right_date).days) > NEAR_DATE_DUPLICATE_DAYS:
        return False
    left_url = str(left.get("source_url") or "").strip()
    if (
        left_url
        and left_url == str(right.get("source_url") or "").strip()
        and not _is_poll_listing_url(left_url)
        and _pollsters_compatible(left, right)
    ):
        return True
    left_matchups = _canonical_matchups(left)
    return (
        bool(left_matchups)
        and left_matchups == _canonical_matchups(right)
        and left.get("sample_size") == right.get("sample_size")
    )


# --- Relabeled same-survey duplicates -------------------------------------------
#
# ia-senate-2026 stored each survey twice after one polling phase: one copy dated at the
# field end, one at the release (4-8 days later), under a differently spelled pollster:
# "Marist University" 10-11 vs "Marist Poll" 10-15, "NPA Polling" 10-12 vs "National
# Public Affairs" 10-20, "GS Strategy Group/New River Strategies (for The Cook Political
# Report)" 10-13 vs "New River / GSG" 10-21. Each pair carried the identical topline.
#
# The rule is deliberately narrow. An identical topline alone never merges unrelated firms
# beyond the near-date window above, and one identically labeled pollster on two dates
# stays two waves (ks-senate-2026 InsiderAdvantage 10-10 and 10-14 repeated a topline).
RELABELED_SURVEY_DAYS = 14

# Words that say what kind of organization a pollster is, not which one.
_GENERIC_POLLSTER_TOKENS = frozenset(
    """
    the for and of by with at in on inc llc ltd co corp company
    poll polls polling pollster pollsters survey surveys research researchers
    university univ college school institute center centre
    group strategies strategy strategic consulting consultants partners associates
    analytics insights data opinion public national affairs political politics report
    news media new times post daily journal tribune star herald
    """.split()
)
_PARENTHETICAL_RE = re.compile(r"\([^()]*\)")
_POLLSTER_SEGMENT_RE = re.compile(r"\s*(?:/|&|\+|,|;|\band\b|\bwith\b|\bfor\b)\s*", re.IGNORECASE)


def _pollster_label(poll: Dict[str, Any]) -> str:
    """Pollster name without population label, party marks, or "(for Sponsor)" notes."""
    name = _PARTY_MARK_RE.sub("", split_poll_population(poll.get("pollster"))[0])
    return _PARENTHETICAL_RE.sub(" ", name)


def _pollster_segments(label: str) -> List[List[str]]:
    """Word lists of each firm a label names ("A/B" or "A & B" names two firms)."""
    segments = []
    for part in _POLLSTER_SEGMENT_RE.split(label):
        words = re.findall(r"[a-z0-9]+", part.casefold())
        if words:
            segments.append(words)
    return segments


def _significant_tokens(segments: List[List[str]]) -> set:
    return {word for words in segments for word in words if len(word) >= 3 and word not in _GENERIC_POLLSTER_TOKENS}


def _is_acronym_of(token: str, words: List[str]) -> bool:
    """True when ``token`` spells a run of 2+ consecutive words by their leading letters.

    "npa" is National Public Affairs; "gsg" is GS Strategy Group (a word may give more
    than its first letter, as "GS" does).
    """
    if not 2 <= len(token) <= 6 or len(words) < 2:
        return False

    def spell(rest: str, index: int, used: int) -> bool:
        if not rest:
            return used >= 2
        if index >= len(words):
            return False
        word = words[index]
        for length in range(1, min(len(word), len(rest)) + 1):
            if word[:length] != rest[:length]:
                break
            if spell(rest[length:], index + 1, used + 1):
                return True
        return False

    return any(spell(token, start, 0) for start in range(len(words)))


def pollster_identities_compatible(left: Any, right: Any) -> bool:
    """Whether two poll entries' pollster labels plausibly name the same firm.

    Compatible when the compacted names are equal or one contains the other, when they
    share a distinctive word ("Marist University" / "Marist Poll"), or when a word of one
    is an acronym of a firm named in the other ("NPA Polling" / "National Public Affairs").
    """
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    left_label, right_label = _pollster_label(left), _pollster_label(right)
    a = re.sub(r"[^a-z0-9]+", "", left_label.casefold())
    b = re.sub(r"[^a-z0-9]+", "", right_label.casefold())
    if not a or not b:
        return False
    if a == b or (min(len(a), len(b)) >= 3 and (a in b or b in a)):
        return True
    left_segments, right_segments = _pollster_segments(left_label), _pollster_segments(right_label)
    if _significant_tokens(left_segments) & _significant_tokens(right_segments):
        return True
    for word_segments, firm_segments in ((left_segments, right_segments), (right_segments, left_segments)):
        for word in {word for words in word_segments for word in words}:
            if any(_is_acronym_of(word, words) for words in firm_segments):
                return True
    return False


def is_relabeled_same_survey(left: Any, right: Any) -> bool:
    """One survey stored twice: field end date vs release date, pollster spelled differently.

    Requires all of: the identical candidate -> percentage map in every matchup (order
    independent, exact numbers); dates within ``RELABELED_SURVEY_DAYS``; equal sample
    sizes, or one missing; and compatible pollster identities
    (``pollster_identities_compatible``) that are not one identical label, because one
    label on two dates is two waves of a tracking poll.
    """
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    left_matchups = _canonical_matchups(left)
    if not left_matchups or not all(left_matchups) or left_matchups != _canonical_matchups(right):
        return False
    left_date, right_date = _poll_date(left), _poll_date(right)
    if left_date is None or right_date is None or abs((left_date - right_date).days) > RELABELED_SURVEY_DAYS:
        return False
    left_sample, right_sample = left.get("sample_size"), right.get("sample_size")
    if left_sample and right_sample and left_sample != right_sample:
        return False
    left_key, right_key = same_survey_key(left), same_survey_key(right)
    if left_key is not None and right_key is not None and left_key[0] == right_key[0]:
        return left_key == right_key
    return pollster_identities_compatible(left, right)


def _record_richness(poll: Dict[str, Any]) -> tuple:
    url = str(poll.get("source_url") or "").strip()
    return (
        bool(poll.get("sample_size")),
        bool(url) and not _is_poll_listing_url(url),
        bool(url),
        len(poll.get("matchups") or []),
        len(normalize_pollster_name(poll.get("pollster"))),
    )


def _richer_first(left: Dict[str, Any], right: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    return (left, right) if _record_richness(left) >= _record_richness(right) else (right, left)


def merge_relabeled_survey(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    """One record from two copies of a survey, keeping every known detail.

    The richer copy (sample size, then a primary-source URL over an aggregator or
    Wikipedia, then any URL) is the base, and fields it lacks come from the other copy.
    The date is the earlier one, the field end date preceding the release, and the
    pollster label is that copy's.
    """
    base, other = _richer_first(left, right)
    merged = copy.deepcopy(base)
    for key, value in other.items():
        if merged.get(key) in (None, "", [], {}) and value not in (None, "", [], {}):
            merged[key] = copy.deepcopy(value)
    left_date, right_date = _poll_date(left), _poll_date(right)
    if left_date is not None and right_date is not None and left_date != right_date:
        # The label travels with its date: "Marist Poll" on the field end date would read as
        # a second wave of the "Marist Poll" release copy, and a refresh would re-add it.
        earlier = left if left_date < right_date else right
        merged["date"] = str(earlier.get("date")).strip()
        merged["pollster"] = earlier.get("pollster")
    return merged


def merge_relabeled_survey_polls(polls: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Collapse relabeled copies of one survey (``is_relabeled_same_survey``) into one entry.

    Returns the kept polls, in their original order, and "pollster (date)" labels of the
    copies merged away.
    """
    kept: List[Any] = []
    removed: List[str] = []
    for poll in polls:
        if isinstance(poll, dict):
            match = next(
                (index for index, existing in enumerate(kept) if is_relabeled_same_survey(existing, poll)),
                None,
            )
            if match is not None:
                existing = kept[match]
                merged = merge_relabeled_survey(existing, poll)
                identity = (merged.get("pollster"), merged.get("date"))
                dropped = poll if (existing.get("pollster"), existing.get("date")) == identity else existing
                removed.append(f"{dropped.get('pollster')} ({dropped.get('date')})")
                kept[match] = merged
                continue
        kept.append(poll)
    return kept, removed


def baseline_poll_invalidity(poll: Any, roster_names: set, polling_note: Any = None) -> Optional[str]:
    """Deterministic reason a stored poll may be dropped, or None when it must be kept."""
    problem = polling_semantic_problem(poll, polling_note)
    if problem:
        return problem
    matchups = [matchup for matchup in poll.get("matchups") or [] if isinstance(matchup, dict)]
    if matchups and roster_names:
        on_roster = [
            matchup
            for matchup in matchups
            if isinstance(matchup.get("candidates"), list)
            and matchup["candidates"]
            and all(str(name).strip() in roster_names for name in matchup["candidates"])
        ]
        if not on_roster:
            return "Every matchup names a candidate who is not on the current roster."
    return None


def restore_dropped_baseline_polls(
    race_json: Dict[str, Any],
    baseline_polls: Any,
    *,
    removals: Optional[List[Dict[str, Any]]] = None,
    log: Any = None,
) -> List[str]:
    """Put back any baseline poll an agent phase lost without a validity reason.

    A baseline poll is satisfied when an entry recording the same survey (``is_same_poll``)
    is still stored, so a relabel ("Trafalgar Group" -> "Trafalgar Group (R)") is not
    duplicated. Otherwise it is restored unless it is now invalid (non-poll entry, or no
    matchup left on the current roster) or remove_poll recorded a validity reason for it
    (``removals`` entries with ``validity: True``). Returns the "pollster (date)" labels restored.
    """
    if not isinstance(baseline_polls, list) or not baseline_polls:
        return []
    polling = race_json.get("polling")
    if not isinstance(polling, list):
        polling = []
        race_json["polling"] = polling
    roster_names = {
        str(candidate.get("name") or "").strip()
        for candidate in race_json.get("candidates") or []
        if isinstance(candidate, dict) and str(candidate.get("name") or "").strip()
    }
    validity_removed = [
        item["poll"]
        for item in removals or []
        if isinstance(item, dict) and item.get("validity") and isinstance(item.get("poll"), dict)
    ]
    restored: List[str] = []
    for poll in baseline_polls:
        if not isinstance(poll, dict):
            continue
        if any(is_same_poll(poll, current) for current in polling):
            continue
        if baseline_poll_invalidity(poll, roster_names, race_json.get("polling_note")):
            continue
        key = same_survey_key(poll)
        if any(removed == poll or (key is not None and same_survey_key(removed) == key) for removed in validity_removed):
            continue
        polling.append(copy.deepcopy(poll))
        restored.append(f"{poll.get('pollster')} ({poll.get('date')})")
    if restored and log:
        log("warning", "Restored baseline poll(s) dropped without a validity reason: " + ", ".join(restored))
    return restored
