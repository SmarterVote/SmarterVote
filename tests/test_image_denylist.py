import pytest

from pipeline_client.agent.image_denylist import DENIED_IMAGE_URLS, is_denied_image
from pipeline_client.agent.images import _is_rejected_candidate_image, _resolve_single_image

LAWLER_NAMESAKE = "https://s3.amazonaws.com/ballotpedia-api4/files/thumbs/200/300/Michael_Lawler.png"
TWO_PERSON = "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jonathan_Kreiss-Tomkins_and_Terry_Gardiner.jpg"


def test_every_entry_explains_the_rejection():
    assert DENIED_IMAGE_URLS
    for url, reason in DENIED_IMAGE_URLS.items():
        assert url.startswith("https://")
        assert reason.strip()


def test_denied_image_matches_regardless_of_scheme_case_and_query():
    assert is_denied_image(LAWLER_NAMESAKE)
    assert is_denied_image(LAWLER_NAMESAKE.replace("https://", "http://"))
    assert is_denied_image(LAWLER_NAMESAKE.upper().replace("HTTPS://", "https://"))
    assert is_denied_image(LAWLER_NAMESAKE + "?width=200")
    assert not is_denied_image("https://s3.amazonaws.com/ballotpedia-api4/files/thumbs/200/300/Michael_Lawler_2.png")
    assert not is_denied_image(None)
    assert not is_denied_image("")


def test_denied_wikimedia_original_also_matches_its_thumbnail():
    thumb = (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/"
        "Jonathan_Kreiss-Tomkins_and_Terry_Gardiner.jpg/250px-Jonathan_Kreiss-Tomkins_and_Terry_Gardiner.jpg"
    )
    assert is_denied_image(TWO_PERSON)
    assert is_denied_image(thumb)


def test_denied_image_counts_as_rejected_candidate_image():
    assert _is_rejected_candidate_image(LAWLER_NAMESAKE, "Michael Lawler")


@pytest.mark.asyncio
async def test_resolve_discards_denied_existing_image_and_skips_it_from_ballotpedia(monkeypatch):
    replacement = "https://upload.wikimedia.org/wikipedia/commons/0/0a/Mike_Lawler_119th_Congress.jpg"
    candidate = {"name": "Michael Lawler", "image_url": LAWLER_NAMESAKE}

    async def fake_check(url: str):
        return True, url

    async def fake_ballotpedia(name: str, state=None):
        # Ballotpedia keeps serving the namesake's portrait for the bare name.
        return LAWLER_NAMESAKE

    async def fake_wikipedia(name: str, context: str = ""):
        return replacement

    async def fail_agent(*args, **kwargs):
        raise AssertionError("agent search should not run when Wikipedia finds an image")

    monkeypatch.setattr("pipeline_client.agent.images._check_url_accessible", fake_check)
    monkeypatch.setattr("pipeline_client.agent.images._lookup_ballotpedia_image", fake_ballotpedia)
    monkeypatch.setattr("pipeline_client.agent.images._lookup_wikipedia_image", fake_wikipedia)

    await _resolve_single_image(candidate, agent_loop_fn=fail_agent, model="test")

    assert candidate["image_url"] == replacement


@pytest.mark.asyncio
async def test_resolve_never_stores_a_denied_image_from_the_agent(monkeypatch):
    candidate = {"name": "Michael Lawler", "image_url": None}

    async def no_image(*args, **kwargs):
        return None

    async def agent_returns_denied(*args, **kwargs):
        return {"image_url": LAWLER_NAMESAKE}

    for lookup in ("_lookup_ballotpedia_image", "_lookup_wikipedia_image", "_lookup_known_page_image", "_lookup_serper_image"):
        monkeypatch.setattr(f"pipeline_client.agent.images.{lookup}", no_image)

    await _resolve_single_image(candidate, agent_loop_fn=agent_returns_denied, model="test")

    assert candidate["image_url"] is None
