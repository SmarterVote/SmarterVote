"""Deterministic neutrality lint for text written in the site's own voice.

Model reviewers miss loaded framing more often than factual errors, because a
phrase like "far-right Republican" reads as description rather than opinion.
Audit 4 found it on the live site in a voting summary and race overview
(IL-15), a forecast ("fringe standing", CO-Sen) and a race description
("radically reshaped", TN-05).

The lint only looks at the site's own voice. Text inside quotation marks, and
words a candidate or outlet is reported as using ("what he calls radical
policies", "described as far-left"), are attributed speech and are skipped.
Party names that contain a flagged word (Socialist Workers, Party for
Socialism and Liberation) are allowlisted.

Calibrated against the 506 published races of 2026-10-01: a broad keyword scan
(radical, extremist, far-left/right, socialist, fringe, controversial, ...)
hit 212 text fields, nearly all candidates' own positions ("deporting
dangerous criminals") or quoted language; this lint keeps the handful written
in the site's voice.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterator, List, Tuple

#: Prefix on every review-flag concern this lint emits, so grading can find them.
NEUTRALITY_CONCERN_PREFIX = "Neutrality:"

_PERSON_NOUNS = (
    r"(?:figure|candidate|congressman|congresswoman|politician|lawmaker|legislator|senator|representative|"
    r"incumbent|nominee|challenger|activist|commentator|businessman|businesswoman|governor|mayor|"
    r"republican|democrat|conservative|liberal|progressive|populist|party|wing|faction|group|movement|"
    r"leader|official|member|campaign|record|tenure|career|past|history|views|rhetoric|statements|remarks)s?"
)

#: (label, pattern). Patterns are matched case-insensitively against text with
#: quoted spans removed.
_LOADED_TERMS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("far-right/far-left", re.compile(r"\bfar[- ](?:right|left)(?:ist)?\b", re.I)),
    ("hard-right/hard-left", re.compile(r"\bhard[- ](?:right|left)(?:ist)?\b", re.I)),
    ("ultra-", re.compile(r"\bultra[- ](?:conservative|liberal|left|right|progressive|maga)\b", re.I)),
    ("extremist", re.compile(r"\bextremists?\b", re.I)),
    ("radical", re.compile(r"\bradical(?:ly|s)?\b", re.I)),
    ("fringe", re.compile(r"\bfringe\b", re.I)),
    ("uncompromising", re.compile(r"\buncompromising\b", re.I)),
    ("firebrand", re.compile(r"\bfirebrands?\b", re.I)),
    ("MAGA extremist", re.compile(r"\bMAGA[- ]extremists?\b", re.I)),
    (
        "controversial (person)",
        re.compile(rf"\bcontroversial\s+(?:(?:former|freshman|first-term|longtime|veteran)\s+)?{_PERSON_NOUNS}\b", re.I),
    ),
    # A person described as controversial: "the controversial Jane Doe".
    ("controversial (person)", re.compile(r"\bthe controversial\s+[A-Z][a-z]+\s+[A-Z][a-z]+", re.UNICODE)),
    (
        "socialist (pejorative)",
        re.compile(
            r"(?<!democratic )(?<!independent )\bsocialists?\s+"
            r"(?:agenda|policies|policy|takeover|schemes?|democrats?|left|leftists?|radicals?|regime|ideas)\b",
            re.I,
        ),
    ),
)

#: Party and organisation names that contain a flagged word.
_ALLOWLIST = re.compile(
    r"\b(?:Socialist Workers(?: Party)?|Socialist Party(?: USA)?|Socialist Alternative|Socialist Equality(?: Party)?|"
    r"Party for Socialism and Liberation|Democratic Socialists of America|Radical Republicans?|"
    r"Peace and Freedom Party)\b",
    re.I,
)

#: Spans in quotation marks: straight double, curly double, and curly single.
_QUOTED = re.compile(r"\"[^\"]*\"|“[^”]*”|‘[^’]*’")

#: Reporting verbs that attribute what follows in the same clause to someone else.
_ATTRIBUTION = re.compile(
    r"\b(?:calls?|called|calling|describes?|described|describing|labels?|labell?ed|labell?ing|terms?|termed|"
    r"characteri[sz]es?|characteri[sz]ed|brands?|branded|dubs?|dubbed|so-called|says?|said|saying|argues?|argued|"
    r"claims?|claimed|accuses?|accused|accusing|criticizes?|criticized|criticizing|warns?|warned|"
    r"according to|denounces?|denounced|attacks?|attacked|opposes?|opposed|opposing|rejects?|rejected|"
    r"refers? to|referred to|referring to|condemns?|condemned|vows?|vowed|pledges?|pledged|promises?|promised|"
    r"wants?|seeks?|proposes?|proposed|"
    r"supports?|supported|views?|viewed|sees?|regards?|fight|fights|fighting|stop|stopping|end|ending|"
    r"what (?:he|she|they|it|the campaign|critics|opponents|supporters) (?:calls?|called|describes?|described|terms?))\b",
    re.I,
)

_SENTENCE_BREAK = re.compile(r"[.!?;:]\s")


def _strip_quotes(text: str) -> str:
    """Blank quoted spans, keeping offsets so a match still points into the original."""
    return _QUOTED.sub(lambda match: " " * len(match.group(0)), text)


def _clause_before(text: str, start: int) -> str:
    """The text from the start of the clause containing *start* up to it."""
    window = text[max(0, start - 240) : start]
    breaks = list(_SENTENCE_BREAK.finditer(window))
    return window[breaks[-1].end() :] if breaks else window


def _is_proper_name(text: str, start: int) -> bool:
    """A capitalized term mid-sentence is part of a name ("the Defeat Extremists PAC"), not a description."""
    if not text[start : start + 1].isupper():
        return False
    before = text[:start].rstrip()
    return bool(before) and before[-1] not in ".!?:;\u2014-("


def find_loaded_language(text: Any) -> List[Dict[str, str]]:
    """Loaded terms written in the site's own voice in *text*.

    Returns one ``{"term", "match", "excerpt"}`` per hit. Quoted spans, allowlisted
    party names and words attributed to someone in the same clause are skipped.
    """
    if not isinstance(text, str) or not text.strip():
        return []
    scrubbed = _strip_quotes(text)
    scrubbed = _ALLOWLIST.sub(lambda match: " " * len(match.group(0)), scrubbed)
    hits: List[Dict[str, str]] = []
    seen: set[int] = set()
    for label, pattern in _LOADED_TERMS:
        for match in pattern.finditer(scrubbed):
            if match.start() in seen:
                continue
            if _is_proper_name(scrubbed, match.start()):
                continue
            if _ATTRIBUTION.search(_clause_before(scrubbed, match.start())):
                continue
            seen.add(match.start())
            excerpt = text[max(0, match.start() - 60) : match.end() + 60].replace("\n", " ").strip()
            hits.append({"term": label, "match": text[match.start() : match.end()], "excerpt": excerpt})
    return hits


def iter_site_voice_text(race_json: Dict[str, Any]) -> Iterator[Tuple[str, str]]:
    """Yield ``(field_path, text)`` for every prose field written in the site's voice."""
    if not isinstance(race_json, dict):
        return
    for key in ("description", "polling_note"):
        value = race_json.get(key)
        if isinstance(value, str):
            yield key, value
    forecast = race_json.get("forecast")
    if isinstance(forecast, dict):
        for key in ("rationale", "takeaway", "uncertainty"):
            value = forecast.get(key)
            if isinstance(value, str):
                yield f"forecast.{key}", value
        for index, reason in enumerate(forecast.get("key_reasons") or []):
            if isinstance(reason, str):
                yield f"forecast.key_reasons[{index}]", reason
    for index, candidate in enumerate(race_json.get("candidates") or []):
        if not isinstance(candidate, dict):
            continue
        for key in ("summary", "voting_summary", "donor_summary"):
            value = candidate.get(key)
            if isinstance(value, str):
                yield f"candidates[{index}].{key}", value
        issues = candidate.get("issues")
        if isinstance(issues, dict):
            for issue_name, issue in issues.items():
                if isinstance(issue, dict) and isinstance(issue.get("stance"), str):
                    yield f"candidates[{index}].issues.{issue_name}.stance", issue["stance"]


def neutrality_flags(race_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Review flags (warning severity) for loaded wording in the site's voice."""
    flags: List[Dict[str, Any]] = []
    for field, text in iter_site_voice_text(race_json):
        hits = find_loaded_language(text)
        if not hits:
            continue
        terms = ", ".join(dict.fromkeys(f'"{hit["match"]}"' for hit in hits))
        flags.append(
            {
                "field": field,
                "concern": f"{NEUTRALITY_CONCERN_PREFIX} loaded wording in the site's own voice ({terms}): "
                f"…{hits[0]['excerpt']}…",
                "suggestion": (
                    "Rewrite neutrally: describe positions, votes or affiliations factually, or quote and attribute "
                    "the characterization to a named source instead of stating it as fact."
                ),
                "severity": "warning",
            }
        )
    return flags


def is_neutrality_flag(flag: Any) -> bool:
    return isinstance(flag, dict) and str(flag.get("concern") or "").startswith(NEUTRALITY_CONCERN_PREFIX)
