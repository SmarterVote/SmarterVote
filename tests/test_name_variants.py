"""Given-name variants used by the roster-evidence checks."""

from shared.name_variants import canonical_given_name, given_name_variants, text_names_given_name


def test_variants_are_symmetric():
    assert "tim" in given_name_variants("timothy")
    assert "timothy" in given_name_variants("tim")
    assert canonical_given_name("Bob") == canonical_given_name("robert")


def test_shared_forms_merge_their_groups():
    # "Pat" is short for both Patrick and Patricia, so all three are one group.
    assert canonical_given_name("patricia") == canonical_given_name("patrick") == canonical_given_name("pat")


def test_unknown_names_match_only_themselves():
    assert given_name_variants("Marisol") == frozenset({"marisol"})
    assert canonical_given_name("marisol") == "marisol"


def test_text_match_is_whole_word():
    assert text_names_given_name("timothy", "candidate: tim long")
    assert not text_names_given_name("timothy", "a long time ago")
