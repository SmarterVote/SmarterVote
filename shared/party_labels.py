"""One display label per party, applied when a candidate's party is written.

Discovery copies party names from whatever source it read, so the published
catalog carried "Democratic", "Democratic Party" and "Democrat" side by side,
and "Constitution" next to "Constitution Party" (audit 4, #18). Labels are
compared by exact string in places (party filters, colour keys, D/R pairing),
so each variant splits one party into several.

Only known parties are rewritten. An unknown "X Party" keeps its full name:
stripping the suffix generically would turn the "Kentucky Party" into
"Kentucky" and the "Voice Party" into "Voice". State-specific official labels
("Democratic-Farmer-Labor", "No Party Affiliation", "Unenrolled") are kept as
the state prints them.
"""

from __future__ import annotations

import re
from typing import Any

_CANONICAL = {
    "d": "Democratic",
    "dem": "Democratic",
    "dems": "Democratic",
    "democrat": "Democratic",
    "democratic": "Democratic",
    "r": "Republican",
    "rep": "Republican",
    "gop": "Republican",
    "republican": "Republican",
    "i": "Independent",
    "ind": "Independent",
    "independent": "Independent",
    "l": "Libertarian",
    "lib": "Libertarian",
    "libertarian": "Libertarian",
    "g": "Green",
    "green": "Green",
    "c": "Constitution",
    "constitution": "Constitution",
    "working class": "Working Class",
    "u.s. taxpayers": "U.S. Taxpayers",
    "us taxpayers": "U.S. Taxpayers",
    "u.s. taxpayers'": "U.S. Taxpayers",
    "independent american": "Independent American",
    "american independent": "American Independent",
    "american constitution": "American Constitution",
    "working families": "Working Families",
    "socialist workers": "Socialist Workers",
    "socialist labor": "Socialist Labor",
    "no labels": "No Labels",
    "forward": "Forward",
    "unity": "Unity",
    "approval voting": "Approval Voting",
    "legal marijuana now": "Legal Marijuana Now",
    "natural law": "Natural Law",
    "socialism and liberation": "Party for Socialism and Liberation",
    "party for socialism and liberation": "Party for Socialism and Liberation",
}


def normalize_party(label: Any) -> Any:
    """The canonical display label for *label*; unknown parties are only tidied.

    >>> normalize_party("Democratic Party"), normalize_party("Constitution Party"), normalize_party("Voice Party")
    ('Democratic', 'Constitution', 'Voice Party')
    """
    if not isinstance(label, str):
        return label
    tidy = re.sub(r"\s+", " ", label).strip()
    if not tidy:
        return tidy
    key = tidy.casefold().rstrip(".")
    if key in _CANONICAL:
        return _CANONICAL[key]
    if key.endswith(" party") and not key.startswith("no "):
        base = key[: -len(" party")].strip()
        if base.startswith("the "):
            base = base[len("the ") :]
        if base in _CANONICAL:
            return _CANONICAL[base]
    return tidy
