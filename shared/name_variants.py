"""Common English given-name variants, for matching a roster name against an official list.

Official candidate lists and campaign pages often use a different form of the
candidate's first name than the roster does. MI-Sen's Board of Elections lists
"Tim Long" where discovery had stored "Timothy Long"; the roster-evidence checks
required every word of the stored name verbatim, rejected the source three
times, and escalated roster sync to a frontier model ($0.79 against ~$0.10).

Only given names are matched loosely. Surnames still have to appear exactly, so
a nickname can never make two different people look like one candidate.
"""

from __future__ import annotations

import re
from typing import Dict, FrozenSet, Iterable

#: Each group is one given name and its common short forms. Groups that share a
#: form (Pat: Patrick and Patricia) are merged, so lookups stay symmetric.
_GROUPS: tuple[tuple[str, ...], ...] = (
    ("abigail", "abby", "abbie"),
    ("alexander", "alex", "alexandra", "alexis"),
    ("andrew", "andy", "drew"),
    ("anthony", "tony"),
    ("barbara", "barb"),
    ("benjamin", "ben", "benny"),
    ("bradley", "brad"),
    ("catherine", "katherine", "kathryn", "cathy", "kathy", "kate", "katie", "kat"),
    ("charles", "charlie", "chuck", "chas"),
    ("christopher", "chris", "kristopher"),
    ("christine", "christina", "chris", "tina"),
    ("daniel", "dan", "danny"),
    ("david", "dave", "davey"),
    ("deborah", "debra", "debbie", "deb"),
    ("donald", "don", "donnie"),
    ("douglas", "doug"),
    ("edward", "ed", "eddie", "ted", "ned"),
    ("elizabeth", "liz", "beth", "betsy", "betty", "eliza"),
    ("frederick", "fred", "freddie"),
    ("gerald", "jerry"),
    ("gregory", "greg"),
    ("harold", "hal", "harry"),
    ("henry", "hank"),
    ("jacob", "jake"),
    ("james", "jim", "jimmy", "jamie"),
    ("jeffrey", "geoffrey", "jeff"),
    ("jennifer", "jen", "jenny"),
    ("john", "jack", "johnny", "jon"),
    ("jonathan", "jon"),
    ("joseph", "joe", "joey"),
    ("joshua", "josh"),
    ("kenneth", "ken", "kenny"),
    ("kimberly", "kim"),
    ("lawrence", "laurence", "larry"),
    ("leonard", "leo", "len", "lenny"),
    ("margaret", "maggie", "meg", "peggy", "marge"),
    ("matthew", "matt"),
    ("michael", "mike", "mick", "mickey"),
    ("nathaniel", "nathan", "nate"),
    ("nicholas", "nick", "nicky"),
    ("patrick", "patricia", "pat", "patty", "trish"),
    ("peter", "pete"),
    ("philip", "phillip", "phil"),
    ("raymond", "ray"),
    ("rebecca", "becky", "becca"),
    ("richard", "rich", "rick", "ricky", "dick"),
    ("robert", "rob", "robbie", "bob", "bobby"),
    ("ronald", "ron", "ronnie"),
    ("samuel", "sam", "sammy", "samantha"),
    ("stephen", "steven", "steve"),
    ("susan", "sue", "susie", "suzanne"),
    ("theodore", "ted", "teddy", "theo"),
    ("thomas", "tom", "tommy"),
    ("timothy", "tim", "timmy"),
    ("victoria", "vicky", "vicki", "tori"),
    ("walter", "walt"),
    ("william", "will", "bill", "billy", "willie"),
    ("zachary", "zach", "zack"),
)


def _build_variant_index(groups: Iterable[tuple[str, ...]]) -> Dict[str, FrozenSet[str]]:
    """Map every form to the full set of forms it is interchangeable with, merging shared forms."""
    sets: list[set[str]] = []
    for group in groups:
        merged = set(group)
        overlapping = [existing for existing in sets if existing & merged]
        for existing in overlapping:
            merged |= existing
            sets.remove(existing)
        sets.append(merged)
    return {name: frozenset(group) for group in sets for name in group}


_VARIANTS: Dict[str, FrozenSet[str]] = _build_variant_index(_GROUPS)


def given_name_variants(token: str) -> FrozenSet[str]:
    """Every form interchangeable with *token* (lower-case), including itself."""
    token = token.casefold()
    return _VARIANTS.get(token, frozenset({token}))


def canonical_given_name(token: str) -> str:
    """One stable representative for *token*'s variant group, for set comparisons."""
    return min(given_name_variants(token))


def text_names_given_name(token: str, text: str) -> bool:
    """Whether *text* (lower-case) contains *token* or one of its variants as a whole word."""
    return any(re.search(rf"\b{re.escape(form)}\b", text) for form in given_name_variants(token))
