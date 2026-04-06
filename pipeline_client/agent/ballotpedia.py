"""Ballotpedia HTML scraping helpers.

Provides structured lookups against ``ballotpedia.org`` candidate pages.  Used
both by the image-resolution pipeline (images.py) and exposed as a first-class
agent tool so the LLM can retrieve clean candidate data without burning Serper
quota.

Note: The Ballotpedia MediaWiki API (``/w/api.php``) was disabled; this module
now scrapes the public HTML pages directly.
"""

import logging
import re
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("pipeline")

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# External-link prefixes that are useful for electoral research.
# We filter the full extlinks list down to these so the agent isn't buried in
# social-sharing trackers and other noise.
_USEFUL_LINK_PREFIXES = (
    "house.gov",
    "senate.gov",
    "governor.",
    "fec.gov",
    "votesmart.org",
    "opensecrets.org",
    "followthemoney.org",
    "congress.gov",
    "ballotpedia.org",
    "wikipedia.org",
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "linkedin.com",
    # campaign sites — very hard to enumerate exhaustively, so keep everything
    # that survived the other filters and looks like a campaign URL
)


def _is_useful_link(url: str) -> bool:
    """Return True for external links that are likely useful to the research agent."""
    url_lower = url.lower()
    # Always keep government / research / finance / social links
    for prefix in _USEFUL_LINK_PREFIXES:
        if prefix in url_lower:
            return True
    # Keep anything that looks like an official campaign site (contains the
    # candidate's role keyword and ends in a real TLD)
    for keyword in ("forsenate", "forgovernor", "forhouse", "forcongress", "forassembly", "campaign"):
        if keyword in url_lower:
            return True
    return False


async def lookup_candidate_image(candidate_name: str) -> Optional[str]:
    """Return a Ballotpedia thumbnail URL for *candidate_name*, or None.

    Uses ``opensearch`` to find the Ballotpedia page then ``pageimages`` to get
    the thumbnail.  This is a focused helper used by the image-resolution
    pipeline (images.py) — for full candidate data use ``lookup_candidate_data``.
    """
    result = await lookup_candidate_data(candidate_name)
    return result.get("image_url") if result else None


async def lookup_candidate_data(candidate_name: str) -> Dict[str, Any]:
    """Scrape a Ballotpedia candidate page for structured data.

    Tries the direct URL first (``/First_Last``), then falls back to
    ``Special:Search`` which redirects on a unique match.

    Returns a dict with keys:
        found (bool), page_url (str|None), extract (str|None),
        external_links (list[str]), image_url (str|None)

    Returns ``{"found": False}`` if the candidate is not found or an error occurs.
    """
    empty: Dict[str, Any] = {"found": False}
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            # Step 1: try the canonical URL derived from the name
            url_name = candidate_name.strip().replace(" ", "_")
            resp = await client.get(
                f"https://ballotpedia.org/{url_name}",
                headers={"User-Agent": _BROWSER_UA},
            )

            # Step 2: fall back to Special:Search (redirects when there is a unique match)
            if resp.status_code != 200:
                resp = await client.get(
                    "https://ballotpedia.org/Special:Search",
                    params={"search": candidate_name},
                    headers={"User-Agent": _BROWSER_UA},
                )

            if resp.status_code != 200:
                return empty

            page_url = str(resp.url)

            # If we ended up on the search-results page the candidate wasn't found
            if "Special:Search" in page_url:
                return empty

            html = resp.text

            # --- Image: first widget-img inside the infobox -----------------
            image_url: Optional[str] = None
            # The infobox renders as: <img src="https://s3.amazonaws.com/..." class="widget-img" />
            infobox_m = re.search(r'class="infobox person".*?<img\s[^>]*src="([^"]+)"[^>]*>', html, re.DOTALL)
            if infobox_m:
                image_url = infobox_m.group(1)

            # --- Extract: first non-trivial <p> inside mw-parser-output -----
            extract: Optional[str] = None
            parser_idx = html.find("mw-parser-output")
            if parser_idx >= 0:
                for para_m in re.finditer(r"<p>(.*?)</p>", html[parser_idx : parser_idx + 30000], re.DOTALL):
                    text = re.sub(r"<[^>]+>", "", para_m.group(1))
                    # Unescape common HTML entities
                    text = text.replace("&#91;", "[").replace("&#93;", "]").replace("&amp;", "&").strip()
                    if len(text) > 30:
                        extract = text[:1200]
                        break

            # --- External links filtered to research-useful domains ---------
            seen: set = set()
            deduped_links: List[str] = []
            for lnk in re.findall(r'href="(https?://[^"]+)"', html):
                if lnk not in seen and _is_useful_link(lnk):
                    seen.add(lnk)
                    deduped_links.append(lnk)

            return {
                "found": True,
                "page_url": page_url,
                "extract": extract,
                "external_links": deduped_links,
                "image_url": image_url,
            }

    except Exception as exc:
        logger.debug("Ballotpedia lookup failed for %r: %s", candidate_name, exc)
        return empty


# ---------------------------------------------------------------------------
# Race / election page lookup
# ---------------------------------------------------------------------------

_STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


def _race_id_to_ballotpedia_url(race_id: str) -> Optional[str]:
    """Attempt to derive a Ballotpedia election page URL from a race_id.

    Handles common patterns:
      {state}-senate-{year}          → United_States_Senate_election_in_{State},{year}
      {state}-governor-{year}        → Gubernatorial_election_in_{State},{year}
      {state}-house-{district}-{year}→ {State}'s_{N}th/st/nd/rd_congressional_district_election,{year}
      {state}-senate-{year}-special  → United_States_Senate_special_election_in_{State},{year}
    """
    parts = race_id.lower().split("-")
    if len(parts) < 3:
        return None

    state_abbr = parts[0].upper()
    state_name = _STATE_NAMES.get(state_abbr)
    if not state_name:
        return None

    # Detect year (last numeric part or second-to-last if suffix like "special")
    year: Optional[str] = None
    suffix = ""
    office_parts: List[str] = []
    for i, p in enumerate(parts[1:], 1):
        if p.isdigit() and len(p) == 4:
            year = p
            remaining = parts[i + 1:]
            suffix = "_".join(remaining) if remaining else ""
            office_parts = parts[1:i]
            break
    if not year:
        return None

    office = "_".join(office_parts)
    state_url = state_name.replace(" ", "_")
    special_infix = "_special" if "special" in suffix else ""

    if office == "senate":
        title = f"United_States_Senate{special_infix}_election_in_{state_url},_{year}"
    elif office == "governor":
        title = f"Gubernatorial{special_infix}_election_in_{state_url},_{year}"
    elif office.startswith("house"):
        # Try to extract district number
        district_parts = office_parts[1:] if len(office_parts) > 1 else []
        district_num_str = district_parts[0] if district_parts else ""
        try:
            n = int(district_num_str)
            suffix_map = {1: "st", 2: "nd", 3: "rd"}
            ordinal = suffix_map.get(n % 10 if n % 100 not in (11, 12, 13) else 0, "th")
            district_label = f"{n}{ordinal}"
        except ValueError:
            district_label = district_num_str or "at-large"
        title = f"{state_url}'s_{district_label}_congressional_district_election,_{year}"
    elif "attorney" in office or "ag" == office:
        title = f"Attorney_General_election_in_{state_url},_{year}"
    elif "secretary" in office or "sos" == office:
        title = f"Secretary_of_State_election_in_{state_url},_{year}"
    elif "treasurer" in office:
        title = f"State_Treasurer_election_in_{state_url},_{year}"
    elif "lieutenant" in office or "lt-gov" in office:
        title = f"Lieutenant_Governor_election_in_{state_url},_{year}"
    else:
        return None

    return f"https://ballotpedia.org/{title}"


def _parse_candidate_list_from_html(html: str) -> List[Dict[str, Any]]:
    """Parse a candidate list from a Ballotpedia election page.

    Returns a list of dicts with keys: name, party, incumbent (bool).
    """
    candidates: List[Dict[str, Any]] = []
    seen: set = set()

    # Ballotpedia election pages list candidates in tables or wikitables.
    # Each row typically has: Name (link), Party, [Incumbent marker]
    # Pattern: candidate links within table rows.
    # We match <a href="/Candidate_Name"> links inside table rows.
    for m in re.finditer(
        r'<tr[^>]*>.*?</tr>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        row_html = m.group(0)
        # Skip header rows
        if "<th" in row_html.lower() and "<td" not in row_html.lower():
            continue
        # Find the candidate name link (first /Name link, not an anchor to a section)
        name_m = re.search(r'href="/([A-Z][^"#?]+)"[^>]*>([^<]+)</a>', row_html)
        if not name_m:
            continue
        raw_name = re.sub(r"<[^>]+>", "", name_m.group(2)).strip()
        if not raw_name or len(raw_name) < 3:
            continue
        # Skip rows that look like section links
        page_slug = name_m.group(1)
        if any(kw in page_slug for kw in ("election", "primary", "general", "party", "district")):
            continue
        # Extract party from row text
        row_text = re.sub(r"<[^>]+>", " ", row_html)
        party = "Unknown"
        for p_kw, p_label in [
            ("republican", "Republican"), ("democrat", "Democratic"),
            ("libertarian", "Libertarian"), ("green", "Green"),
            ("independent", "Independent"), ("constitution", "Constitution"),
        ]:
            if p_kw in row_text.lower():
                party = p_label
                break
        incumbent = bool(re.search(r"incumbent", row_text, re.IGNORECASE))

        key = raw_name.lower()
        if key not in seen:
            seen.add(key)
            candidates.append({"name": raw_name, "party": party, "incumbent": incumbent})

    return candidates


async def lookup_election_page(race_id: str) -> Dict[str, Any]:
    """Fetch the Ballotpedia election page for a race and return a candidate roster.

    Args:
        race_id: Race identifier (e.g. "ar-senate-2026", "ga-governor-2026").

    Returns a dict with:
        found (bool), page_url (str|None), candidates (list of {name, party, incumbent}),
        description (str|None — intro paragraph from the page).
    """
    empty: Dict[str, Any] = {"found": False, "candidates": [], "page_url": None, "description": None}
    url = _race_id_to_ballotpedia_url(race_id)
    if not url:
        logger.debug("Could not derive Ballotpedia URL for race_id %r", race_id)
        return empty

    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _BROWSER_UA})
            if resp.status_code != 200:
                logger.debug("Ballotpedia election page %s returned %d", url, resp.status_code)
                return {**empty, "page_url": url, "http_status": resp.status_code}

            page_url = str(resp.url)
            html = resp.text

            candidates = _parse_candidate_list_from_html(html)

            # Extract first paragraph from mw-parser-output as description
            description: Optional[str] = None
            parser_idx = html.find("mw-parser-output")
            if parser_idx >= 0:
                for para_m in re.finditer(r"<p>(.*?)</p>", html[parser_idx: parser_idx + 20000], re.DOTALL):
                    text = re.sub(r"<[^>]+>", "", para_m.group(1))
                    text = text.replace("&#91;", "[").replace("&#93;", "]").replace("&amp;", "&").strip()
                    if len(text) > 40:
                        description = text[:800]
                        break

            logger.debug("Ballotpedia election page %s: found %d candidates", page_url, len(candidates))
            return {
                "found": True,
                "page_url": page_url,
                "candidates": candidates,
                "description": description,
            }

    except Exception as exc:
        logger.debug("Ballotpedia election lookup failed for %r: %s", race_id, exc)
        return empty
