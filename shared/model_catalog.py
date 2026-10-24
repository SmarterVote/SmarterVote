"""The single source of truth for every model SmarterVote can run.

Everything that picks a model — the research agent, the roster adjudicator, the
review panel, the chamber-forecast endpoint, the MCP tools — resolves it from
here. Nothing else may hardcode an OpenRouter model ID. Four separate copies of
the chamber-forecast model had already drifted apart (two of them to a model
that was both older *and* dearer on output) before this module existed, so the
rule is deliberately absolute: one literal, one place.

It lives in ``shared/`` rather than under ``pipeline_client/agent/`` because
``services/races-api`` needs it too and only ``shared/`` is copied into that
container.

Three kinds of fact live here, and they are maintained differently:

* **Prices and context windows** are the provider's facts. They drift weekly and
  are verified against OpenRouter's live model list by
  ``scripts/check_model_catalog.py``. Never edit them from memory.
* **Intelligence index** is our capability yardstick — Artificial Analysis
  Intelligence Index v4.3.2, captured 2026-09-26 from each model's page on
  artificialanalysis.ai (highest reasoning effort shown). Nothing can verify it
  automatically, so it is written down explicitly and cited. It exists because
  price is *not* a proxy for capability: nemotron-3-ultra cost 6.7x more per
  input token than deepseek-v4-flash-0731 while scoring 12 points *lower*, and
  the guard's price-based escalation check waved that through for months.

  **Never mix index versions.** v4.3.2 re-baselined every score to roughly
  0.7x its v4.1 value (Sonnet 5: 53.4 -> 38), so a new model's current score
  written next to an old model's v4.1 score reads as a downgrade that is not
  one. Third-party mirrors (benchlm.ai) mix the two; read AA's own model page.
* **Role assignments** are our judgment, argued in comments at each choice.

Adding a model? Add it to :data:`MODEL_CATALOG` with a real intelligence score
and run ``python scripts/check_model_catalog.py`` before committing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Mapping, Optional

# ---------------------------------------------------------------------------
# Roles and profiles
# ---------------------------------------------------------------------------

#: Every distinct job a model is chosen for. ``model_overrides`` is validated
#: against this set.
MODEL_ROLES = frozenset({"primary", "small", "roster", "image_vision", "review_claude", "review_gemini", "review_grok"})

#: Two real profiles, plus ``custom`` for a run that overrides roles by hand.
#:
#: There used to be three. ``balanced`` sat between ``economy`` and ``quality``
#: and was strictly dominated by both: its only difference from ``economy`` was a
#: primary model scoring 25.0 against economy's 49.9 (index v4.1) while costing 2.8x more per
#: input token. Nobody could have wanted it. Two tiers — the one you run, and
#: the one you pay for — is the whole useful range.
MODEL_PROFILES = frozenset({"default", "premium", "custom"})

#: Runs queued before the two-profile consolidation still carry the old names,
#: and so do stored run records the admin UI replays. Map them forward.
#: ``balanced`` folds into ``default`` because that is what it should always
#: have been.
LEGACY_PROFILE_ALIASES: Dict[str, str] = {
    "economy": "default",
    "balanced": "default",
    "quality": "premium",
}


@dataclass(frozen=True)
class ModelSpec:
    """One model, priced per million tokens.

    ``intelligence`` is the Artificial Analysis Intelligence Index v4.3.2 score.
    It is the field the escalation guard reasons about — see the module
    docstring for why output price cannot stand in for it.
    """

    id: str
    label: str
    input_per_m: float
    output_per_m: float
    #: Price of a cached input-token read. ``None`` means the provider does not
    #: offer cache reads through OpenRouter.
    cached_input_per_m: Optional[float]
    context_window_tokens: int
    intelligence: float
    max_completion_tokens: Optional[int] = None
    #: Whether the provider accepts a ``tool_choice`` that forces a specific
    #: function. Some models reject it with HTTP 400 ("tool_choice: type tool
    #: and any are not supported for this model"). For those, the agent loop's
    #: forced final tool call falls back to ``tool_choice: "auto"`` plus an
    #: explicit instruction naming the function (``pipeline_client/agent/llm.py``).
    #: Set from a live probe, not from OpenRouter's endpoint metadata: that
    #: metadata reports Haiku 5.5 as unforceable, yet it honours a forced call.
    forced_tool_choice: bool = True


# ---------------------------------------------------------------------------
# Prompt caching — measured, 2026-08-07
# ---------------------------------------------------------------------------
#
# The latest 250 production metric records are 31.4:1 input:output
# (170.4M:5.4M, measured 2026-08-13), so cache behaviour matters more than any
# other price on this page. It is also entirely provider-specific and not
# something you can read off the OpenRouter price list, so it was measured
# directly: identical 5.7k-token prefix, sent twice, with and without an
# explicit `cache_control` breakpoint.
#
#   openai      implicit, works.   Luna: $0.00072 cold -> $0.000077 warm (10.6x)
#   deepseek    implicit, works.   Flash: $0.00082 cold -> $0.00012 warm (7x)
#   x-ai        implicit, works.   Grok 4.3 warm: $0.0027
#   google      implicit: NONE.    Explicit `cache_control`: 2.6x cheaper
#   anthropic   implicit: NONE.    Explicit: 8.2x warm, but +24% on a cold write
#
# **Do not add `cache_control` to x-ai requests.** It does not merely fail to
# help — it *suppresses* Grok's implicit caching (cached tokens fell from 5888
# to 192) and made the same call 3.3x more expensive. That is the trap this
# note exists to prevent.
#
# Google and Anthropic would benefit from an explicit breakpoint, but only over
# a stable prefix worth caching. The one prefix we re-send to them is
# ``REVIEW_SYSTEM`` at ~740 tokens — below Anthropic's 2048-token minimum, so
# it would never engage, while the large part of a review prompt (the race
# packet) changes on every call by design. So there is no caching code in the
# pipeline, deliberately.
#
# This used to matter much more: the roster role ran on Gemini, which caches
# nothing implicitly, and it was 36% of the bill. Moving roster onto DeepSeek
# closed that gap without any caching code at all. Realized discount across
# production runs before the move was 4.2%.


# ---------------------------------------------------------------------------
# The catalog
# ---------------------------------------------------------------------------
#
# Curated, not exhaustive: OpenRouter serves 458 models and we keep the ones
# that are the best answer to some question we actually ask. Every entry is
# reachable through a profile role, an explicit `model_overrides` request, or a
# stored run record that still has to price correctly.
#
# Prices, context windows, and completion limits verified against OpenRouter
# live 2026-10-24 (for a model with a provider preference, against the endpoint
# we route to). Intelligence is AA Intelligence Index v4.3.2, captured
# 2026-09-26; GPT-6.1 Sol, Haiku 5.5, Sonnet 5.5, Opus 5.5 and Gemini 4 Argon
# added from their AA pages (all labelled v4.3.2) 2026-10-24.

MODEL_CATALOG: Dict[str, ModelSpec] = {
    # --- OpenAI: GPT-6 family (2026-09-22) ---------------------------------
    # Level with GPT-5.6 on the index (Luna 37.26 vs 37.32, Sol 47.5 vs 47) at
    # half the Luna price, and AA measured both using roughly half the tokens
    # per task. The regressions AA found are in long-form deliverable
    # presentation (GDPval-AA -75 Elo), which is not a job we give them;
    # hallucination abstention *improved* (Luna 93% -> 77%). Luna was
    # live-probed on the roster adjudicator before the swap: 12/12 correct on
    # labelled membership cases, no empty verdicts under the 400-token ceiling.
    "openai/gpt-6-luna": ModelSpec(
        "openai/gpt-6-luna",
        "GPT-6 Luna",
        0.10,
        0.50,
        0.01,
        1_050_000,
        37.3,
        128_000,
    ),
    # Superseded by GPT-6.1 Sol at the same price. Kept so stored runs and
    # explicit overrides still price correctly.
    "openai/gpt-6-sol": ModelSpec("openai/gpt-6-sol", "GPT-6 Sol", 2.00, 10.00, 0.20, 1_050_000, 47.5, 128_000),
    # --- OpenAI: GPT-6.1 (2026-09-29) --------------------------------------
    # Same $2/$10 as GPT-6 Sol with cached reads at half the price ($0.10 vs
    # $0.20), and 52 against 47.5 on the index. Live-probed 2026-10-24: returns
    # a forced tool call and plain JSON output.
    "openai/gpt-6.1-sol": ModelSpec("openai/gpt-6.1-sol", "GPT-6.1 Sol", 2.00, 10.00, 0.10, 1_050_000, 52.0, 128_000),
    # --- OpenAI: GPT-5.6 family (2026-07-09) -------------------------------
    # Superseded by GPT-6. Sol was repriced to $4/$20 in October 2026. Kept so stored runs
    # and explicit overrides still price correctly.
    "openai/gpt-5.6-luna": ModelSpec(
        "openai/gpt-5.6-luna",
        "GPT-5.6 Luna",
        0.20,
        1.20,
        0.02,
        1_050_000,
        37.3,
        128_000,
    ),
    "openai/gpt-5.6-terra": ModelSpec(
        "openai/gpt-5.6-terra",
        "GPT-5.6 Terra",
        2.00,
        12.00,
        0.20,
        1_050_000,
        42.0,
        128_000,
    ),
    "openai/gpt-5.6-sol": ModelSpec("openai/gpt-5.6-sol", "GPT-5.6 Sol", 4.00, 20.00, 0.40, 1_050_000, 47.0, 128_000),
    # --- DeepSeek ----------------------------------------------------------
    # The default research model until 2026-09-26, replaced by V4.1 Flash below.
    # It has the lowest list input price in the catalog, but it escalated to Sol
    # far more often: in the trial it cited URLs it never fetched, tripped the
    # roster-source guards, and 2 of 5 runs climbed to Sol for 80% of the
    # arm's cost. Kept for overrides and for pricing stored runs.
    "deepseek/deepseek-v4-flash-0731": ModelSpec(
        "deepseek/deepseek-v4-flash-0731",
        "DeepSeek V4 Flash (07-31)",
        0.04444,
        0.13332,
        0.001414,
        1_048_576,
        34.0,
        131_072,
    ),
    # The default research and roster model. Five index points above 0731.
    # Provider prices for it span ~15x and OpenRouter will not route to the
    # cheap ones on its own, so it is pinned to Baidu (fp8) with fallbacks; see
    # MODEL_PROVIDER_PREFERENCES. The price and completion limit below are
    # Baidu's endpoint, not OpenRouter's headline figure. Pinned to the 4.1 slug
    # so a provider upgrade cannot move the research model with no commit to
    # point at.
    "deepseek/deepseek-v4.1-flash": ModelSpec(
        "deepseek/deepseek-v4.1-flash",
        "DeepSeek V4.1 Flash",
        0.0537,
        0.2148,
        0.001074,
        1_048_576,
        39.0,
        393_216,
    ),
    # The 2026-10-17 snapshot of V4.1 Flash: 45 on the index, six points above
    # the default. In the catalog for a live A/B trial through research_model
    # overrides only; no profile role uses it. Pinned to DeepInfra fp8 with Sail
    # Research as fallback (see MODEL_PROVIDER_PREFERENCES); the price and
    # completion limit below are DeepInfra's standard fp8 endpoint, which is
    # what a bare ``deepinfra`` pin bills, not OpenRouter's headline figure.
    "deepseek/deepseek-v4.1-flash-1017": ModelSpec(
        "deepseek/deepseek-v4.1-flash-1017",
        "DeepSeek V4.1 Flash (10-17)",
        0.098,
        0.294,
        0.00294,
        1_048_576,
        45.0,
        131_072,
    ),
    # --- Google ------------------------------------------------------------
    "google/gemini-3.1-flash-lite": ModelSpec(
        "google/gemini-3.1-flash-lite",
        "Gemini 3.1 Flash Lite",
        0.25,
        1.50,
        0.025,
        1_048_576,
        16.0,
        65_536,
    ),
    "google/gemini-3.5-flash-lite": ModelSpec(
        "google/gemini-3.5-flash-lite",
        "Gemini 3.5 Flash Lite",
        0.30,
        2.50,
        0.03,
        1_048_576,
        22.0,
        65_536,
    ),
    # 3.6 and 3.7 Flash cost $0.75/$3.75 (3.7 launched at half that and was
    # repriced); 3.8 was raised 10% to $0.825/$4.125 in October 2026. The index
    # still climbs 34 -> 39 -> 41, and 3.8 returns forced tool calls, which 3.7
    # failed 6 of 6 times.
    #
    # 3.8 Flash is the default Gemini reviewer (2026-10-24), replacing 3.5 Flash
    # Lite: 41 against 22 for ~2.7x the input price. Reviews run a few times
    # per full run, so that is ~$0.05 a run, and it is offset by the Claude seat
    # moving from Haiku 4.5 ($1/$5) to Haiku 5.5 ($0.10/$0.50). The $0.825
    # headline is Vertex US; AI Studio and Vertex global charge $0.75/$3.75 and
    # a pinned AI Studio probe billed $0.75, but pinning is not done because a
    # bare ``google-ai-studio`` slug also matches the /flex and /priority tiers.
    "google/gemini-3.6-flash": ModelSpec(
        "google/gemini-3.6-flash",
        "Gemini 3.6 Flash",
        0.75,
        3.75,
        0.075,
        1_048_576,
        34.0,
        65_536,
    ),
    "google/gemini-3.7-flash": ModelSpec(
        "google/gemini-3.7-flash",
        "Gemini 3.7 Flash",
        0.75,
        3.75,
        0.075,
        1_048_576,
        39.0,
        65_536,
    ),
    "google/gemini-3.8-flash": ModelSpec(
        "google/gemini-3.8-flash",
        "Gemini 3.8 Flash",
        0.825,
        4.125,
        0.0825,
        1_048_576,
        41.0,
        65_536,
    ),
    # Gemini 4 Argon (2026-10-13): Google's flagship, 53 on the index at
    # $2/$10 with $0.10 cached reads, i.e. GPT-6.1 Sol's price. The premium
    # Gemini reviewer and, through DEFAULT_CHAMBER_FORECAST_MODEL, the
    # single-model chamber writer. Live-probed 2026-10-24: forced tool call and
    # plain JSON both pass. It is *not* the roster completeness reviewer: on the
    # labelled completeness cases it read the subject as the whole roster and
    # rejected 2 of 3 sound bundles, where Opus 5.5 got 3 of 3.
    "google/gemini-4-argon": ModelSpec(
        "google/gemini-4-argon",
        "Gemini 4 Argon",
        2.00,
        10.00,
        0.10,
        1_048_576,
        53.0,
        943_718,
    ),
    # --- Anthropic ---------------------------------------------------------
    # Anthropic models do no implicit prompt caching through OpenRouter (Haiku
    # 5.5 re-measured 2026-10-24: 0 cached tokens on an identical warm prefix)
    # and their tokenizer counts ~1.6x the tokens OpenAI's does for the same
    # text (10,832 vs 6,826). So for a long tool loop that re-sends its prefix
    # every turn, an Anthropic model at OpenAI's list price costs several times
    # more. They earn their seats on single-shot calls: review, adjudication,
    # chamber narratives.
    #
    # Haiku 4.5 is old (2025-10-15) and weak, and no longer fills any role. It
    # was kept as the default Claude reviewer because it was the only sub-$2
    # Anthropic model OpenRouter served. Kept so stored runs still price.
    "anthropic/claude-haiku-4.5": ModelSpec(
        "anthropic/claude-haiku-4.5",
        "Claude Haiku 4.5",
        1.00,
        5.00,
        0.10,
        200_000,
        17.0,
        64_000,
    ),
    # Haiku 5.5 (2026-10-07): $0.10/$0.50 against Haiku 4.5's $1/$5, index 43
    # against 17 (AA v4.3.2, read 2026-10-24). Live-probed 2026-10-24: forced
    # tool call and plain JSON both pass (OpenRouter's endpoint metadata says it
    # cannot be forced; the provider disagrees). The default Claude reviewer
    # and the roster adjudicator; see ADJUDICATOR_MODEL. Not the small model:
    # see the Anthropic note above.
    "anthropic/claude-haiku-5.5": ModelSpec(
        "anthropic/claude-haiku-5.5",
        "Claude Haiku 5.5",
        0.10,
        0.50,
        0.01,
        1_000_000,
        43.0,
        128_000,
    ),
    # Sonnet 5 and Opus 5 are superseded by their 5.5 releases below, which are
    # stronger and no dearer. Kept so stored runs and overrides still price.
    "anthropic/claude-sonnet-5": ModelSpec(
        "anthropic/claude-sonnet-5",
        "Claude Sonnet 5",
        2.00,
        10.00,
        0.20,
        1_000_000,
        38.0,
        128_000,
    ),
    "anthropic/claude-opus-5": ModelSpec(
        "anthropic/claude-opus-5",
        "Claude Opus 5",
        5.00,
        25.00,
        0.50,
        1_000_000,
        51.0,
        128_000,
    ),
    # Sonnet 5.5 (2026-09-28): 56 against Sonnet 5's 38 at the same $2/$10, with
    # half the cached-read price. Opus 5.5 (2026-09-22): 58 against Opus 5's 51
    # and cheaper on every price. Both reject a forced tool_choice from every
    # provider (re-probed 2026-10-24: HTTP 400, "tool_choice: type tool and any
    # are not supported for this model"), so they carry
    # ``forced_tool_choice=False`` and the agent loop asks for its final tool
    # call by instruction instead; both then called the named function under
    # ``tool_choice: "auto"`` in the same probe. Plain JSON passes on both.
    # Every role that uses them today — review, chamber narratives, chamber
    # synthesis, roster completeness — is a plain-JSON call that sends no
    # tools; the fallback matters for the escalation edge into FRONTIER_MODEL
    # and for any override that runs them in a tool loop.
    "anthropic/claude-sonnet-5.5": ModelSpec(
        "anthropic/claude-sonnet-5.5",
        "Claude Sonnet 5.5",
        2.00,
        10.00,
        0.10,
        1_000_000,
        56.0,
        128_000,
        forced_tool_choice=False,
    ),
    "anthropic/claude-opus-5.5": ModelSpec(
        "anthropic/claude-opus-5.5",
        "Claude Opus 5.5",
        4.00,
        20.00,
        0.20,
        1_000_000,
        58.0,
        128_000,
        forced_tool_choice=False,
    ),
    # --- xAI ---------------------------------------------------------------
    # Grok version strings sort by decimal, not integer: 4.20 (2026-03-31) is
    # *older* than 4.3 (2026-04-30), which is older than 4.5 (2026-07-08).
    # Reading them the other way once put the premium reviewer on an older
    # model than the default one. Release dates decide, never string order.
    #
    # Grok 4.3 was the default Grok reviewer and forecast-panel member until
    # 2026-10-24, and was poor value: 25 on the index at $1.25/$2.50. OpenRouter
    # serves no cheaper current xAI general model (grok-build-0.1 is a coding
    # build), so the default seat moved up to 4.7 rather than sideways. Kept so
    # stored runs still price.
    "x-ai/grok-4.3": ModelSpec("x-ai/grok-4.3", "Grok 4.3", 1.25, 2.50, 0.20, 1_000_000, 25.0),
    "x-ai/grok-4.5": ModelSpec("x-ai/grok-4.5", "Grok 4.5", 2.00, 6.00, 0.30, 500_000, 39.0),
    "x-ai/grok-4.6": ModelSpec("x-ai/grok-4.6", "Grok 4.6", 2.00, 6.00, 0.50, 500_000, 44.0),
    # The newest xAI model OpenRouter serves (2026-09-21) and +2 index over 4.6
    # at the same $2/$6, so it is both Grok seats. It once answered a
    # probability tool field as a percentage (64.0) in 2 of 3 draws; that is
    # harmless in the forecast panel, which rescales every member's
    # probabilities to sum to 1 (`shared.forecast_math.normalize_probabilities`).
    # Live-probed 2026-10-24: forced tool call and plain JSON both pass.
    "x-ai/grok-4.7": ModelSpec("x-ai/grok-4.7", "Grok 4.7", 2.00, 6.00, 0.50, 500_000, 46.0),
}


# ---------------------------------------------------------------------------
# Named roles
# ---------------------------------------------------------------------------

#: Research and roster work for the default profile. Huge prompts, small
#: completions (22:1 input:output across the latest 500 production records,
#: 2026-09-26).
#:
#: Chosen over DeepSeek 0731 by a paired trial on 2026-09-26: the same 5 House
#: races, the same discovery+polling+forecast steps, a published baseline.
#:
#:   0731 (the incumbent)                    $0.80   2 of 5 escalated to Sol
#:   V4.1 Flash, OpenRouter default routing  $0.86   0 escalated
#:   V4.1 Flash, routed to InferenceNet      $0.20   0 escalated
#:
#: (InferenceNet later repriced ~3x; the model is now routed to Baidu. See
#: MODEL_PROVIDER_PREFERENCES.)
#:
#: All three arms produced identical rosters. Per-token list price is the wrong
#: lens here: 0731 is cheaper per token but spends more tokens and escalates.
#: What decides the bill is escalation to Sol, and routing (arm 2 paid ~7x list).
DEFAULT_RESEARCH_MODEL = "deepseek/deepseek-v4.1-flash"

#: Same jobs under ``premium``. This was Terra, chosen as "the cheapest model
#: that genuinely beats the default research model" against a catalogued
#: $1.00/$6.00 that OpenRouter never charged — Terra is really $2.00/$12.00.
#: At true prices Sol *strictly dominates* it: identical input and cache price,
#: identical 1.05M context, cheaper output ($10 vs $12), and 47 against 42.
#: There is no axis on which Terra is the better buy, so nothing selects it.
#: GPT-6 Sol then replaced GPT-5.6 Sol at an identical price: +0.5 index and
#: roughly half the output tokens per task by AA's measurement. GPT-6.1 Sol
#: replaced GPT-6 Sol in turn: same $2/$10, half the cached-read price, 52
#: against 47.5.
PREMIUM_RESEARCH_MODEL = "openai/gpt-6.1-sol"

#: Bounded sub-agent work and the roster adjudication gate, in *both* profiles.
#: Deliberately not the research model — see :data:`ADJUDICATOR_MODEL`.
#:
#: The second-largest line in the bill (301M prompt tokens across the latest
#: 500 runs), so GPT-6 Luna — same index as GPT-5.6 Luna at half the price on
#: every axis — roughly halves it.
#:
#: Haiku 5.5 has the same list price and scores 43 against 37.3, but it is not
#: the cheaper model here. This role runs long tool loops (polling, voter
#: resources, issue sub-agents) that re-send a growing prefix every turn. Luna
#: caches that prefix implicitly (warm read 11.7x cheaper, re-measured
#: 2026-10-24); Haiku 5.5 caches none of it and tokenizes the same text into
#: ~1.6x the tokens. Moving it would multiply this line several times over.
SMALL_MODEL = "openai/gpt-6-luna"

#: Ceiling for escalation. Nothing routes here by default.
#:
#: Sol became the premium research model, so it can no longer also be the place
#: research escalates *to* — a self-edge would fail the escalation guard and, more
#: to the point, would not be an escalation. Opus 5.5 (58) is the strongest
#: catalogued model and cheaper than Opus 5 on every price. It is the target
#: for GPT-6 Sol when an override still names it, and the chamber synthesis
#: model. It rejects a forced tool_choice (``forced_tool_choice=False``), so a
#: tool loop that escalates here asks for its final call by instruction.
FRONTIER_MODEL = "anthropic/claude-opus-5.5"

#: The review panel keeps three different houses in both profiles: models from
#: one lab share blind spots, so a second opinion from the same lab is worth
#: less. The Grok seat stays by owner preference. Moved 2026-10-24 from
#: Haiku 4.5 / Gemini 3.5 Flash Lite / Grok 4.3 (17 / 22 / 25 on the index) to
#: 43 / 41 / 46; the Claude move saves about what the other two add.
DEFAULT_REVIEW_CLAUDE = "anthropic/claude-haiku-5.5"
DEFAULT_REVIEW_GEMINI = "google/gemini-3.8-flash"
DEFAULT_REVIEW_GROK = "x-ai/grok-4.7"

#: Each house's strongest model that answers a plain-JSON review. Grok 4.7 is
#: already the newest xAI model, so both profiles share it.
PREMIUM_REVIEW_CLAUDE = "anthropic/claude-sonnet-5.5"
PREMIUM_REVIEW_GEMINI = "google/gemini-4-argon"
PREMIUM_REVIEW_GROK = "x-ai/grok-4.7"

#: The fail-closed reading-comprehension gate in front of every roster edit.
#:
#: Pinned rather than profile-resolved: a floating choice would let a provider
#: upgrade move a publish gate with no commit to point at.
#:
#: It must differ from the `primary` and `roster` models of **every** profile.
#: The gate's whole claim to independence is that the model producing the
#: evidence is not the model judging it, and roster edits are made from both
#: roster-phase loops (roster model) and metadata/refinement loops (primary
#: model). ``scripts/check_model_catalog.py`` enforces the separation.
#:
#: Haiku 5.5 since 2026-10-24, replacing GPT-6 Luna: same list price, 43
#: against 37.3, and a different *house* from both research models (DeepSeek,
#: OpenAI), where Luna shared a lab with the premium research model. On the
#: labelled cases in ``tests/test_roster_adjudicator_live.py``, two draws each
#: under the 400-token ceiling, both scored 18/18 with no empty verdicts. Each
#: verdict is one short, uncached call, so Anthropic's lack of implicit caching
#: costs little here, unlike in the small model's tool loops.
#:
#: It does **not** get ``temperature=0``, and neither did Luna: no OpenRouter
#: endpoint for either lists ``temperature`` as a supported parameter, so it
#: is dropped in transit. Determinism rests on the pinned model and the
#: verdict cache, not on sampling.
ADJUDICATOR_MODEL = "anthropic/claude-haiku-5.5"

#: Strong, independent second look used only when every ordinary completeness
#: judgment rejects a structurally valid roster-evidence bundle. A plain-JSON
#: call. Opus 5.5 answered all three labelled completeness cases correctly at
#: the 1,200-token ceiling (2026-10-24); Gemini 4 Argon, the strongest
#: non-Anthropic candidate, got one of three. It shares a lab with the
#: adjudicator, but it is consulted only after that gate has already said no,
#: so a shared blind spot can only keep a block in place, never open one.
ROSTER_COMPLETENESS_REVIEW_MODEL = "anthropic/claude-opus-5.5"

#: Chamber-forecast narratives: a handful of long-context calls over every
#: published race summary, run by hand from the admin UI rather than per race.
#: Volume is negligible, so this takes the strong Gemini rather than the cheap
#: one. Imported by the races-api endpoint and the MCP tool — never re-typed.
DEFAULT_CHAMBER_FORECAST_MODEL = PREMIUM_REVIEW_GEMINI

#: The race-forecast panel. Each member estimates every race independently —
#: numbers only, without seeing the others or the previous forecast — and the
#: published probability is their median (`shared.forecast_math`).
#:
#: Three developers rather than three sizes of one: models trained by the same
#: lab share blind spots, so their disagreement tells you less. Measured
#: 2026-09-14 on the production forecast prompt, three draws each: repeat draws
#: of one model moved only +/-0.02-0.03, but models differed from one another
#: by up to five points on a 14-poll Senate race — enough, alone, to push the
#: rating across a band edge. Gemini 3.7 Flash is not a member: it returned no
#: usable forced tool call in 6 of 6 attempts on the same prompt. (3.8 Flash
#: does return one; it is a candidate if the panel ever wants a Google seat.)
#:
#: Members answer through a forced ``submit_forecast_estimate`` call. The Grok
#: seat follows the default reviewer onto Grok 4.7 (2026-10-24): the panel's
#: Grok calls ran ~6.6k prompt tokens a race across the latest 40 production
#: runs, so the move costs about half a cent a race. All three remain cheap,
#: and the panel adds ~$0.02 per race.
FORECAST_PANEL_MODELS: tuple[str, ...] = (DEFAULT_RESEARCH_MODEL, SMALL_MODEL, DEFAULT_REVIEW_GROK)

#: Chamber narratives are a few calls per regeneration over the whole map, not
#: per race, so their panel takes each house's flagship. Each drafts the note
#: independently from the same computed numbers. Plain JSON, no tools, so
#: Sonnet 5.5 needs no tool-choice fallback here.
CHAMBER_FORECAST_PANEL_MODELS: tuple[str, ...] = (PREMIUM_REVIEW_CLAUDE, PREMIUM_RESEARCH_MODEL, PREMIUM_REVIEW_GROK)

#: Merges the chamber panel's drafts into the published note and holds every
#: claim to the computed numbers. The strongest catalogued model; it runs once
#: per chamber, three times per regeneration. Plain JSON, no tools.
CHAMBER_FORECAST_SYNTHESIS_MODEL = FRONTIER_MODEL

#: Looks at a candidate photo before it is stored and answers structural
#: questions about it — how many faces, is it a photograph at all, is the face
#: obscured, does it look archival.
#:
#: It was the cheapest vision-capable model in the catalog when it was chosen.
#: GPT-6 Luna and DeepSeek V4.1 Flash now also take images for less, but this
#: one is the model the labelled dry run below validated; re-run that dry run
#: before moving the role. The questions are perceptual rather than analytical, and a dry run over 57
#: hand-labelled images from live races showed the flash-lite tier answering
#: them as reliably as anything dearer would: 17 of 24 unusable images caught,
#: and the only rejection of a "good" image was an archival portrait that was
#: in fact the wrong person. At ~1,350 input tokens per image this prices a
#: full catalog sweep at well under a dollar.
DEFAULT_IMAGE_VISION_MODEL = "google/gemini-3.1-flash-lite"


PROFILE_DEFAULTS: Dict[str, Dict[str, str]] = {
    # What every queued race runs unless someone pays for more.
    "default": {
        "primary": DEFAULT_RESEARCH_MODEL,
        "small": SMALL_MODEL,
        # Roster verification decides who is on the ballot, so it used to get a
        # different, supposedly stronger model than research. That reasoning
        # inverted when DeepSeek shipped 0731: the "stronger" roster model
        # (gemini-3.5-flash-lite) scores 36.5 against research's 49.9 (index v4.1), while
        # costing 3.3x more per input token. It was the single largest line in
        # the bill — 36% of LLM spend on 21% of the tokens — and being weak in a
        # long tool loop, it tripped the tool-error escalation that accounted
        # for another 26%. Both problems end here.
        "roster": DEFAULT_RESEARCH_MODEL,
        "image_vision": DEFAULT_IMAGE_VISION_MODEL,
        "review_claude": DEFAULT_REVIEW_CLAUDE,
        "review_gemini": DEFAULT_REVIEW_GEMINI,
        "review_grok": DEFAULT_REVIEW_GROK,
        # Note: `roster` matching `primary` is a coincidence of the current
        # catalog, not a merge of the two roles. It stays a separate role so a
        # roster regression is a one-line fix, and so `premium` can differ.
    },
    # Research and roster move up a real tier and the reviewers go to their
    # flagships (Grok already is one). Review is where quality is actually decided and it runs a
    # handful of times per race rather than once per candidate/issue pair.
    "premium": {
        "primary": PREMIUM_RESEARCH_MODEL,
        "small": SMALL_MODEL,
        "roster": PREMIUM_RESEARCH_MODEL,
        # Perceptual, not analytical: a dearer model answers "how many faces"
        # no better, so premium pays for review instead.
        "image_vision": DEFAULT_IMAGE_VISION_MODEL,
        "review_claude": PREMIUM_REVIEW_CLAUDE,
        "review_gemini": PREMIUM_REVIEW_GEMINI,
        "review_grok": PREMIUM_REVIEW_GROK,
    },
}


#: Where a model goes when it stalls: repeated JSON-parse failures or blocked
#: tool edits. Merely reaching a long loop's final-synthesis turn is not a
#: quality failure and must not trigger an upgrade on the largest prompt.
#:
#: Every edge must climb the intelligence index. That sounds obvious and was not
#: true: the previous map sent deepseek-v4-flash-0731 (49.9, v4.1) to
#: nemotron-3-ultra (37.8) at 6.7x the input price, and because
#: ``check_model_catalog.py`` compared *output price* rather than capability, it
#: reported the downgrade as a healthy escalation. The guard now compares
#: :attr:`ModelSpec.intelligence`, so this cannot come back.
#:
#: Edges stay inside one provider family wherever possible so prompt behaviour
#: does not shift mid-loop.
MODEL_ESCALATION: Dict[str, str] = {
    DEFAULT_RESEARCH_MODEL: PREMIUM_RESEARCH_MODEL,  # 39.0 -> 52.0
    # The previous research model, still reachable through model_overrides.
    "deepseek/deepseek-v4-flash-0731": PREMIUM_RESEARCH_MODEL,  # 34.0 -> 52.0
    # The 10-17 snapshot, on trial through model_overrides; climbs like the default.
    "deepseek/deepseek-v4.1-flash-1017": PREMIUM_RESEARCH_MODEL,  # 45.0 -> 52.0
    SMALL_MODEL: PREMIUM_RESEARCH_MODEL,  # 37.3 -> 52.0
    # PREMIUM_RESEARCH_MODEL deliberately has no edge: premium is the ceiling,
    # and a premium loop that stalls fails rather than climbing to a frontier
    # price tier (owner decision, 2026-10-24).
    # The previous premium model, still reachable through model_overrides.
    "openai/gpt-6-sol": FRONTIER_MODEL,  # 47.5 -> 58.0
    DEFAULT_REVIEW_CLAUDE: PREMIUM_REVIEW_CLAUDE,  # 43.0 -> 56.0
    DEFAULT_REVIEW_GEMINI: PREMIUM_REVIEW_GEMINI,  # 41.0 -> 53.0
    # DEFAULT_REVIEW_GROK is PREMIUM_REVIEW_GROK (Grok 4.7, the newest xAI
    # model), so it has no edge: a self-edge is not an escalation.
    # The previous default reviewers, still reachable through model_overrides.
    "anthropic/claude-haiku-4.5": PREMIUM_REVIEW_CLAUDE,  # 17.0 -> 56.0
    "google/gemini-3.5-flash-lite": PREMIUM_REVIEW_GEMINI,  # 22.0 -> 53.0
    "x-ai/grok-4.3": PREMIUM_REVIEW_GROK,  # 25.0 -> 46.0
}


#: Preferred OpenRouter providers for a model, tried in order before OpenRouter's
#: own routing takes over (fallbacks stay on, so a slow or down provider costs
#: money, never a run).
#:
#: OpenRouter's default routing weighs uptime and latency, not only price, and for
#: some models that sends every request to a provider charging several times the
#: list price. Measured 2026-09-26 on DeepSeek V4.1 Flash: default routing and
#: ``sort=price`` both chose Together ($0.30/M uncached) over InferenceNet
#: ($0.035/M), and a 5-race refresh trial paid ~7x list as a result. Pinning
#: InferenceNet returned list price with working tool calls, at ~5s latency.
#:
#: InferenceNet then repriced to $0.103/$0.715/$0.008, so on 2026-10-24 the pin
#: moved to Baidu fp8 ($0.0537/$0.2148/$0.001074), the cheapest healthy endpoint
#: on every price that matters at our 22:1 input:output mix. Sail Research fp4
#: ($0.09/$0.25/$0.006) is next, and InferenceNet the last pinned fallback. All
#: three returned a forced tool call and plain JSON with fallbacks disabled.
#: Decart ($0.09/$0.18/$0.018) is deliberately absent: OpenRouter's tool
#: compatibility filter drops it from any request with a forced tool_choice.
#:
#: The V4.1 Flash 10-17 snapshot (override-only trial) pins DeepInfra fp8
#: ($0.098/$0.294/$0.00294), then Sail Research fp4 ($0.101/$0.15/$0.006735);
#: both returned a forced tool call with fallbacks disabled on 2026-10-24.
#: DeepSeek's own endpoint cannot force a tool call, and Baidu charges $0.28
#: input for this snapshot, so neither is pinned.
#:
#: Keys are catalog model IDs; values are OpenRouter provider slugs (the
#: endpoint ``tag`` without its ``/variant`` suffix; ``provider.order`` takes
#: the bare slug and matches every endpoint of that provider). The catalog guard
#: checks that each slug still serves its model, and checks the catalog price
#: against the first slug's endpoint.
MODEL_PROVIDER_PREFERENCES: Dict[str, tuple[str, ...]] = {
    "deepseek/deepseek-v4.1-flash": ("baidu", "sail-research", "inference-net"),
    "deepseek/deepseek-v4.1-flash-1017": ("deepinfra", "sail-research"),
}

#: Old model strings that still appear in stored run options and race records.
#: Every value must be a live catalog key, so replaying an old run resolves to
#: something real rather than falling back to a default price.
LEGACY_MODEL_ALIASES: Dict[str, str] = {
    # Bare names for models still in the catalog.
    "gpt-5.6-luna": "openai/gpt-5.6-luna",
    "gpt-5.6-terra": "openai/gpt-5.6-terra",
    "gpt-5.6-sol": "openai/gpt-5.6-sol",
    "deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
    "deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
    "deepseek-v4.1-flash-1017": "deepseek/deepseek-v4.1-flash-1017",
    "gpt-6-luna": "openai/gpt-6-luna",
    "gpt-6-sol": "openai/gpt-6-sol",
    "gpt-6.1-sol": "openai/gpt-6.1-sol",
    "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
    "claude-haiku-5.5": "anthropic/claude-haiku-5.5",
    "claude-sonnet-5": "anthropic/claude-sonnet-5",
    "claude-sonnet-5.5": "anthropic/claude-sonnet-5.5",
    "claude-opus-5": "anthropic/claude-opus-5",
    "claude-opus-5.5": "anthropic/claude-opus-5.5",
    "gemini-4-argon": "google/gemini-4-argon",
    "gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite": "google/gemini-3.5-flash-lite",
    "gemini-3.6-flash": "google/gemini-3.6-flash",
    "gemini-3.7-flash": "google/gemini-3.7-flash",
    "gemini-3.8-flash": "google/gemini-3.8-flash",
    "grok-4.3": "x-ai/grok-4.3",
    "grok-4.5": "x-ai/grok-4.5",
    "grok-4.6": "x-ai/grok-4.6",
    "grok-4.7": "x-ai/grok-4.7",
    # Retired models, mapped to their nearest current equivalent so historical
    # runs still price and re-run sensibly.
    "openai/gpt-5.4": "openai/gpt-6.1-sol",
    "openai/gpt-5.4-mini": "openai/gpt-6-luna",
    "openai/gpt-5-nano": "openai/gpt-6-luna",
    "gpt-5.4": "openai/gpt-6.1-sol",
    "gpt-5.4-mini": "openai/gpt-6-luna",
    "gpt-5-nano": "openai/gpt-6-luna",
    "deepseek/deepseek-v4-flash": "deepseek/deepseek-v4.1-flash",
    # V4 Pro was only ever an override, and V4.1 Flash beats it on index and price.
    "deepseek/deepseek-v4-pro": "deepseek/deepseek-v4.1-flash",
    "deepseek-v4-pro": "deepseek/deepseek-v4.1-flash",
    "deepseek-v4-flash": "deepseek/deepseek-v4.1-flash",
    "deepseek/deepseek-chat-v3-0324": "deepseek/deepseek-v4.1-flash",
    "deepseek-v3-0324": "deepseek/deepseek-v4.1-flash",
    "anthropic/claude-sonnet-4.6": "anthropic/claude-sonnet-5",
    "claude-sonnet-4-6": "anthropic/claude-sonnet-5",
    "claude-3-5-sonnet-20241022": "anthropic/claude-sonnet-5",
    "claude-3-haiku-20240307": "anthropic/claude-haiku-4.5",
    "google/gemini-3.1-pro-preview": "google/gemini-3.6-flash",
    "gemini-3.1-pro-preview": "google/gemini-3.6-flash",
    "google/gemini-3-flash-preview": "google/gemini-3.6-flash",
    "gemini-3-flash-preview": "google/gemini-3.6-flash",
    "google/gemini-3.5-flash": "google/gemini-3.6-flash",
    "gemini-3.5-flash": "google/gemini-3.6-flash",
    "google/gemini-2.5-flash": "google/gemini-3.5-flash-lite",
    "gemini-2.5-flash": "google/gemini-3.5-flash-lite",
    "google/gemini-3.1-flash-lite-preview": "google/gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview": "google/gemini-3.1-flash-lite",
    "x-ai/grok-4.20": "x-ai/grok-4.3",
    "grok-4.20-0309-reasoning": "x-ai/grok-4.3",
    "grok-4-1-fast-non-reasoning": "x-ai/grok-4.3",
    "grok-3-mini": "x-ai/grok-4.3",
    # Nemotron was only ever an escalation target, and a downgrade at that.
    "nvidia/nemotron-3-super-120b-a12b": "deepseek/deepseek-v4.1-flash",
    "nvidia/nemotron-3-ultra-550b-a55b": "openai/gpt-5.6-terra",
    "nemotron-3-super": "deepseek/deepseek-v4.1-flash",
    "nemotron-3-ultra": "openai/gpt-5.6-terra",
}


#: Display names for models we no longer run but that still appear in stored run
#: records. A historical run must render as the model it actually used, so these
#: are labels only — never resolve a *new* run onto one of these. Anything with
#: a current equivalent is in :data:`LEGACY_MODEL_ALIASES` as well; the two serve
#: different purposes and both are needed.
RETIRED_MODEL_LABELS: Dict[str, str] = {
    "openai/gpt-5.4": "GPT-5.4",
    "openai/gpt-5.4-mini": "GPT-5.4 Mini",
    "openai/gpt-5-nano": "GPT-5 Nano",
    "anthropic/claude-sonnet-4.6": "Claude Sonnet 4.6",
    "google/gemini-3-flash-preview": "Gemini 3 Flash (Preview)",
    "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro (Preview)",
    "google/gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite (Preview)",
    "google/gemini-3.5-flash": "Gemini 3.5 Flash",
    "google/gemini-2.5-flash": "Gemini 2.5 Flash",
    "x-ai/grok-4.20": "Grok 4.20",
    "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
    "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek/deepseek-chat-v3-0324": "DeepSeek V3 0324",
    "nvidia/nemotron-3-super-120b-a12b": "Nemotron 3 Super",
    "nvidia/nemotron-3-ultra-550b-a55b": "Nemotron 3 Ultra",
}


# ---------------------------------------------------------------------------
# Resolution helpers
# ---------------------------------------------------------------------------


def normalize_model_id(model: Optional[str]) -> Optional[str]:
    """Return the OpenRouter model ID for a legacy or canonical model string."""
    if model is None:
        return None
    value = str(model).strip()
    if not value:
        return None
    return LEGACY_MODEL_ALIASES.get(value, value)


def normalize_profile_name(profile: Optional[str]) -> Optional[str]:
    """Map a profile name — current or retired — onto a current one.

    Returns ``None`` for ``None`` so callers can distinguish "not requested"
    from "requested and invalid"; raises for a name that was never valid.
    """
    if profile is None:
        return None
    value = str(profile).strip().lower()
    if not value:
        return None
    value = LEGACY_PROFILE_ALIASES.get(value, value)
    if value not in MODEL_PROFILES:
        raise ValueError("model_profile must be one of: default, premium, custom")
    return value


def label_for(model: Optional[str]) -> str:
    """Return a display name for any model string we have ever run.

    Current models come from the catalog, retired ones from
    :data:`RETIRED_MODEL_LABELS`. A historical run renders as the model it
    actually used, never as whatever replaced it.
    """
    value = str(model or "").strip()
    if not value:
        return ""
    spec = MODEL_CATALOG.get(value)
    if spec:
        return spec.label
    retired = RETIRED_MODEL_LABELS.get(value)
    if retired:
        return retired
    aliased = LEGACY_MODEL_ALIASES.get(value)
    if aliased and aliased in MODEL_CATALOG:
        return MODEL_CATALOG[aliased].label
    return value


def spec_for(model: Optional[str]) -> Optional[ModelSpec]:
    """Return the catalog entry for a model string, or ``None`` if unknown."""
    normalized = normalize_model_id(model)
    return MODEL_CATALOG.get(normalized) if normalized else None


def intelligence_of(model: Optional[str]) -> Optional[float]:
    """Return a model's intelligence index, or ``None`` if it is not catalogued."""
    spec = spec_for(model)
    return spec.intelligence if spec else None


def accepts_forced_tool_choice(model: Optional[str]) -> bool:
    """Whether *model* honours a ``tool_choice`` that forces a named function.

    An uncatalogued model is assumed to, which keeps today's request shape for
    anything we have not probed.
    """
    spec = spec_for(model)
    return spec.forced_tool_choice if spec else True


def escalation_for(model: Optional[str]) -> Optional[str]:
    """Return the model to climb to when *model* stalls, if there is one."""
    normalized = normalize_model_id(model)
    return MODEL_ESCALATION.get(normalized) if normalized else None


def provider_routing_for(model: Optional[str]) -> Optional[Dict[str, object]]:
    """Return the OpenRouter ``provider`` request object for *model*, if it has a preference."""
    normalized = normalize_model_id(model)
    order = MODEL_PROVIDER_PREFERENCES.get(normalized) if normalized else None
    if not order:
        return None
    return {"order": list(order), "allow_fallbacks": True}


def resolve_profile_models(
    profile: Optional[str] = None,
    *,
    overrides: Mapping[str, str] | None = None,
) -> Dict[str, str]:
    """Return ``{role: model_id}`` for *profile*, with per-role overrides applied.

    ``custom`` resolves from ``default`` and expects overrides to do the rest.
    """
    resolved_profile = normalize_profile_name(profile) or "default"
    base = "default" if resolved_profile == "custom" else resolved_profile
    models = dict(PROFILE_DEFAULTS[base])
    for role, value in (overrides or {}).items():
        if str(role) not in MODEL_ROLES:
            raise ValueError(f"Unknown model_overrides role: {role}")
        normalized = normalize_model_id(value if isinstance(value, str) else None)
        if normalized:
            models[str(role)] = normalized
    return models
