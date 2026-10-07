"""Deterministic clean-up of model-written prose before it is published.

Three defects the live site showed in audit 4 (2026-10-01):

* **No-position variants.** The catalog marker for a researched absence is the
  exact string ``"No public position found"``; the frontend collapses it. Models
  paraphrase it ("No specific public position was identified on ...", "No public
  stance published on Tech & AI by ..."), and the paraphrase displays as if it
  were a real position. :func:`normalize_no_position_stance` maps a stance that
  says *only* that nothing was found back to the marker. A stance that opens
  that way and then reports something real ("No newer statement was found
  after August 24. In a 2014 questionnaire he said ...") is kept as written,
  because collapsing it would throw away sourced content.
* **Pipeline language.** "...was not found in the provided search results",
  "according to the provided sources", "VPAP lists her fundraising as N/A".
  :func:`clean_pipeline_language` rewrites those to reader-facing wording.
* **Placeholders.** "(to be updated)", "TBD", "TODO", "N/A" as a whole stance.
  :func:`is_placeholder_text` treats them as empty.
"""

from __future__ import annotations

import re
from typing import Any, Optional

#: The one machine-readable marker for a researched absence of a position.
NO_POSITION_MARKER = "No public position found"

#: Whole-field placeholders (compared after trimming brackets and punctuation).
PLACEHOLDER_TEXTS = frozenset(
    {
        "",
        "tbd",
        "tba",
        "todo",
        "to do",
        "fixme",
        "n/a",
        "na",
        "none",
        "null",
        "unknown",
        "pending",
        "draft",
        "placeholder",
        "wip",
        "coming soon",
        "to be updated",
        "to be added",
        "to be determined",
        "to be announced",
        "to be confirmed",
        "update pending",
        "insert stance here",
    }
)

_PLACEHOLDER_TRIM = " \t\r\n.()[]{}<>*-_—–:;!?\"'"


def is_placeholder_text(value: Any) -> bool:
    """True when *value* is empty or nothing but a placeholder such as "(to be updated)"."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    return value.strip(_PLACEHOLDER_TRIM).casefold() in PLACEHOLDER_TEXTS


# ---------------------------------------------------------------------------
# No-position variants
# ---------------------------------------------------------------------------

_NO_POSITION_OPENER = re.compile(
    r"^\s*(?:there (?:is|was|were|are) )?no\s+(?:[\w&/,'’.-]+\s+){0,8}?"
    r"(?:position|positions|stance|stances|statement|statements|platform|views?|policy|policies|proposals?|plans?|agenda)\b",
    re.I,
)
#: Words saying nothing was found, which the opening clause must contain.
_ABSENCE_VERB = re.compile(
    r"\b(?:found|identified|located|stated|published|listed|documented|available|appears?|"
    r"articulated|announced|disclosed|confirmed|issued|outlined|specified|addressed)\b",
    re.I,
)
#: Clauses that only narrate the search or the absence.
_ABSENCE_CLAUSES = (
    re.compile(
        r"\b(?:do|does|did|have|has)(?: not|n[’']t)\s+(?:yet\s+)?(?:address|state|mention|show|present|provide|include|"
        r"list|discuss|publish|cover|identify|establish|document|contain|offer|outline|specify|appear)",
        re.I,
    ),
    re.compile(r"^\s*(?:and\s+)?no\b.*\b(?:found|identified|located|stated|published|documented|available|appears?)\b", re.I),
    re.compile(r"\bunable to (?:confirm|find|locate|identify|verify)\b", re.I),
    re.compile(r"\bwith limited explicit positions\b", re.I),
    re.compile(r"^\s*(?:the )?campaign(?:'s|’s)? (?:site|website|materials|page)s? focus(?:es)? on\b", re.I),
    re.compile(r"\b(?:were|was) reviewed\b.*\b(?:do|does|did) not\b", re.I),
)
_CLAUSE_SPLIT = re.compile(r"(?<=[.!?;])\s+")


#: A clause reporting something the candidate said or did is content, not absence.
_SUBSTANCE = re.compile(
    r"\b(?:said|says|saying|supports?|supported|opposes?|opposed|emphasi[sz]es?|emphasi[sz]ed|calls? for|called for|"
    r"favors?|favored|voted|votes|sponsored|co-?sponsored|backs?|backed|wants?|interested|proposes?|proposed|"
    r"pledged?|promised?|argues?|argued|endorsed|advocates?|advocated)\b",
    re.I,
)


def _is_absence_clause(clause: str) -> bool:
    if _SUBSTANCE.search(clause):
        return False
    return any(pattern.search(clause) for pattern in _ABSENCE_CLAUSES)


def is_no_position_variant(stance: Any) -> bool:
    """True when *stance* says only that no position was found, in any wording."""
    if not isinstance(stance, str):
        return False
    text = stance.strip()
    if not text or text == NO_POSITION_MARKER:
        return False
    if NO_POSITION_MARKER.casefold() in text.casefold() and len(text) <= len(NO_POSITION_MARKER) + 2:
        return True
    clauses = [clause for clause in _CLAUSE_SPLIT.split(text) if clause.strip()]
    first = clauses[0]
    if not _NO_POSITION_OPENER.match(first) or not _ABSENCE_VERB.search(first):
        return False
    # "No detailed position was identified, but he is endorsed by ..." reports something.
    if re.search(r",?\s+but\b|\bhowever\b|\balthough\b", first, re.I):
        return False
    return all(_is_absence_clause(clause) for clause in clauses[1:])


def normalize_no_position_stance(stance: Any) -> Any:
    """The exact marker for a no-position variant; anything else unchanged."""
    if isinstance(stance, str) and is_no_position_variant(stance):
        return NO_POSITION_MARKER
    return stance


# ---------------------------------------------------------------------------
# Pipeline language
# ---------------------------------------------------------------------------

_PIPELINE_REPLACEMENTS = (
    # "...was found in the provided search results" -> "...was found in available sources"
    (
        re.compile(
            r"\b(in|from|within|among|by|across)\s+(?:the\s+)?(?:provided|available|reviewed|returned|retrieved|current)?\s*"
            r"search results\b",
            re.I,
        ),
        r"\1 available sources",
    ),
    (
        re.compile(r"\baccording to the (?:provided|supplied|given) (?:sources|evidence|materials)\b", re.I),
        "according to available sources",
    ),
    (re.compile(r"\b(?:the )?(?:provided|supplied|given) (?:sources|evidence|materials)\b", re.I), "available sources"),
    (re.compile(r"\b(?:the )?(?:provided|available|retrieved) search results\b", re.I), "available sources"),
    (re.compile(r"-source search results\b", re.I), "-source records"),
    (re.compile(r"\bsearch results\b", re.I), "sources"),
    # "VPAP lists her fundraising as N/A" -> "... as not available"
    (re.compile(r"(?<![\w/-])N/A(?![\w/-])"), "not available"),
)


def _keep_case(match: "re.Match[str]", replacement: str) -> str:
    """Expand *replacement*, capitalized when it opens a sentence ("Search results" -> "Sources")."""
    expanded = match.expand(replacement)
    before = match.string[: match.start()].rstrip()
    if expanded and (not before or before[-1] in ".!?") and match.group(0)[:1].isupper():
        return expanded[0].upper() + expanded[1:]
    return expanded


def clean_pipeline_language(text: Any) -> Any:
    """Rewrite research-pipeline wording in reader-facing prose. Non-strings pass through."""
    if not isinstance(text, str) or not text:
        return text
    cleaned = text
    for pattern, replacement in _PIPELINE_REPLACEMENTS:
        cleaned = pattern.sub(lambda match, repl=replacement: _keep_case(match, repl), cleaned)
    return re.sub(r"[ \t]{2,}", " ", cleaned)


def clean_prose_field(text: Any) -> Optional[Any]:
    """Pipeline-language clean-up for a prose field; placeholders become ``None``."""
    if isinstance(text, str) and text.strip() and is_placeholder_text(text):
        return None
    return clean_pipeline_language(text)


# ---------------------------------------------------------------------------
# Candidate-summary polling lint
# ---------------------------------------------------------------------------
#
# A candidate summary is a short biography. Audit 5 (2026-10-07) found published
# summaries quoting polls ("a CNN/SSRS poll showed him at 47%", "leads 48%-44%"),
# which go stale within days and belong in the polling section. The prompts say
# so; this lint is the cheap deterministic check that they were obeyed. It is
# deliberately narrow so that election *results* ("won the primary with 77% of
# the vote") are never flagged.

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")
_PERCENT = re.compile(r"\b\d{1,3}(?:\.\d+)?\s*(?:%|percent\b|per cent\b)", re.I)
#: Poll vocabulary that never describes an election result. "polling place",
#: "polling station", "polling location" and "poll worker" are biography.
_POLL_WORD = re.compile(
    r"\b(?:polls?|polled|pollsters?|polling)\b(?!\s+(?:places?|stations?|locations?|sites?|workers?|booths?|hours?))",
    re.I,
)
#: "Survey" also names agencies (U.S. Geological Survey), so it counts only beside
#: a percentage or survey-of-voters wording.
_SURVEY_WORD = re.compile(r"\b(?:survey|surveys|surveyed)\b", re.I)
_SURVEY_CONTEXT = re.compile(r"\b(?:voters|respondents|likely|registered|electorate|margin of error)\b", re.I)
_SURVEY_AGENCY = re.compile(r"\b(?:geological|land|coast and geodetic)\s+survey\b", re.I)
#: "leads 48%-44%", "trails Smith 41 to 45", "ahead 47-42".
_MATCHUP_LEAD = re.compile(
    r"\b(?:leads?|leading|trails?|trailing|ahead|behind)\b[^.;]{0,40}?"
    r"\b\d{1,2}(?:\.\d)?\s*%?\s*(?:-|–|—|to)\s*\d{1,2}(?:\.\d)?\s*%?",
    re.I,
)
#: Approval/favorability numbers are poll output too.
_APPROVAL = re.compile(r"\b(?:approval|favorability|favourability|favorable)\s+(?:rating|ratings|numbers?)\b", re.I)


def find_summary_polling_content(text: Any) -> list[str]:
    """Sentences of *text* that report opinion-poll content. Empty when the text is clean.

    Flags a sentence that mentions a poll or pollster, a survey of voters or with
    a percentage, a numeric "leads/trails X-Y" matchup, or an approval rating
    with a percentage. Election results with percentages are not flagged.
    """
    if not isinstance(text, str) or not text.strip():
        return []
    hits: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(text.strip()):
        has_percent = bool(_PERCENT.search(sentence))
        survey = bool(_SURVEY_WORD.search(sentence)) and not _SURVEY_AGENCY.search(sentence)
        if (
            _POLL_WORD.search(sentence)
            or (survey and (has_percent or _SURVEY_CONTEXT.search(sentence)))
            or _MATCHUP_LEAD.search(sentence)
            or (has_percent and _APPROVAL.search(sentence))
        ):
            hits.append(sentence.strip())
    return hits


def summary_contains_polling(text: Any) -> bool:
    """Whether a candidate summary reports opinion-poll content (see :func:`find_summary_polling_content`)."""
    return bool(find_summary_polling_content(text))
