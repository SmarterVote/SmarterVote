"""Candidate photo URLs a human audit found to show the wrong person.

The images step keeps any reachable existing photo and its fast lookups can
return the same file again (Ballotpedia serves a namesake's portrait under a
bare-name filename), so a wrong photo survives every rerun. URLs listed here are
discarded when found on a candidate and never accepted from any lookup.

Add an entry only after looking at the image: key is the URL as stored, value
says who is pictured or why it is unusable.
"""

from typing import Any, Dict
from urllib.parse import unquote, urlparse

DENIED_IMAGE_URLS: Dict[str, str] = {
    "https://s3.amazonaws.com/ballotpedia-api4/files/thumbs/200/300/Michael_Lawler.png": (
        "namesake: an older man, not U.S. Rep. Mike Lawler (NY-17)"
    ),
    "https://kykernel.com/wp-content/uploads/2026/08/Quigley-Ad.png": (
        "campaign ad with a partisan slogan across it, not a headshot (Robert Quigley, KY-06)"
    ),
    "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jonathan_Kreiss-Tomkins_and_Terry_Gardiner.jpg": (
        "two-person photo; the candidate cannot be identified"
    ),
    "https://s3.amazonaws.com/ballotpedia-api4/files/thumbs/200/300/Brett_Smith.jpg": (
        "bare-name Ballotpedia portrait (a man in a suit, studio backdrop) that cannot be tied to Brett Smith, "
        "the Pacific Green nominee for Oregon governor, whose own page is Brett_Smith_(Oregon)"
    ),
}


def _image_key(url: str) -> str:
    """Host and path, case-folded, ignoring scheme, query and fragment.

    Wikimedia originals and their ``/thumb/.../250px-`` forms share one key, since
    the images step stores thumbnails of originals.
    """
    parsed = urlparse(unquote(url.strip()))
    host = parsed.netloc.lower()
    parts = [p for p in parsed.path.split("/") if p]
    if host == "upload.wikimedia.org" and len(parts) >= 5:
        # /wikipedia/commons/a/ab/File.jpg or /wikipedia/commons/thumb/a/ab/File.jpg/250px-File.jpg
        filename = parts[5] if parts[2] == "thumb" and len(parts) >= 6 else parts[4]
        return f"{host}/{filename}".lower()
    return f"{host}{parsed.path}".lower()


_DENIED_KEYS = frozenset(_image_key(url) for url in DENIED_IMAGE_URLS)


def is_denied_image(url: Any) -> bool:
    """True when *url* is a photo a human audit rejected."""
    if not isinstance(url, str) or not url.strip():
        return False
    return _image_key(url) in _DENIED_KEYS
