"""Public address -> state / congressional district lookup (Census geocoder proxy).

The My Ballot page used to call the Census geocoder from the browser via JSONP,
which forced ``https://geocoding.geo.census.gov`` onto the site's script-src
allowlist. That endpoint executes any ``callback=`` it is given, so an HTML
injection anywhere on the site could have used it to run arbitrary script
despite the hash-based CSP. This proxy lets the browser use ``fetch`` instead.

Privacy: the request is a POST with the address in a JSON body, so the address
never appears in a URL — Cloud Run request logs and uvicorn access logs record
the request line (path + query string) but not the body. Nothing here logs the
address, and the analytics middleware skips ``/geocode`` entirely. The response
carries only the state name and the raw congressional-district fields the
client needs to derive a district code.
"""

import logging
import re
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from rate_limit import limiter

logger = logging.getLogger("races_api")

router = APIRouter(prefix="/geocode", tags=["geocode"])

CENSUS_GEOGRAPHIES_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
CENSUS_TIMEOUT_SECONDS = 10.0
MAX_ADDRESS_LENGTH = 200
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_DISTRICT_FIELD = re.compile(r"^CD\d+$")
_DISTRICT_PASSTHROUGH_FIELDS = ("GEOID", "BASENAME", "NAME")


class CensusGeocodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address: str = Field(..., min_length=3, max_length=MAX_ADDRESS_LENGTH)

    @field_validator("address")
    @classmethod
    def _clean_address(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if _CONTROL_CHARS.search(cleaned) or len(cleaned) < 3:
            raise ValueError("Enter a street address, city, and state.")
        return cleaned


def _first_match_geographies(payload: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    matches = (payload.get("result") or {}).get("addressMatches")
    if not isinstance(matches, list) or not matches or not isinstance(matches[0], dict):
        return None
    geographies = matches[0].get("geographies")
    return geographies if isinstance(geographies, dict) else None


def parse_census_geographies(payload: Any) -> Optional[Dict[str, Any]]:
    """Reduce a Census geographies response to ``{state, congressional_district}``.

    ``congressional_district`` keeps the raw ``CD###`` field(s) (the name
    changes with each Congress), ``GEOID``, ``BASENAME`` and ``NAME`` so the
    client's existing district-code logic works unchanged.
    """
    geographies = _first_match_geographies(payload)
    if geographies is None:
        return None
    states = geographies.get("States")
    state = states[0].get("NAME") if isinstance(states, list) and states and isinstance(states[0], dict) else None
    if not isinstance(state, str) or not state:
        return None

    district_entry: Optional[Dict[str, Any]] = None
    for layer, entries in geographies.items():
        if str(layer).endswith("Congressional Districts") and isinstance(entries, list) and entries:
            if isinstance(entries[0], dict):
                district_entry = entries[0]
                break
    if district_entry is None:
        return None

    district = {
        key: value
        for key, value in district_entry.items()
        if (_DISTRICT_FIELD.match(str(key)) or key in _DISTRICT_PASSTHROUGH_FIELDS)
        and isinstance(value, (str, int))
        and not isinstance(value, bool)
    }
    if not district:
        return None
    return {"state": state, "congressional_district": district}


@router.post("/census")
@limiter.limit("20/minute")
async def geocode_census(body: CensusGeocodeRequest, request: Request, response: Response) -> Dict[str, Any]:
    """Resolve a one-line U.S. address to its state and congressional district."""
    response.headers["Cache-Control"] = "no-store"
    params = {
        "address": body.address,
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=CENSUS_TIMEOUT_SECONDS) as client:
            upstream = await client.get(CENSUS_GEOGRAPHIES_URL, params=params)
    except httpx.TimeoutException:
        logger.warning("Census geocoder timed out")
        raise HTTPException(status_code=504, detail="The address service took too long to respond.")
    except httpx.HTTPError as exc:
        # Log the exception type only: httpx error messages can embed the URL,
        # which carries the address.
        logger.warning("Census geocoder request failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The address service is unavailable right now.")

    if upstream.status_code >= 400:
        logger.warning("Census geocoder returned HTTP %s", upstream.status_code)
        raise HTTPException(status_code=502, detail="The address service is unavailable right now.")
    try:
        payload = upstream.json()
    except ValueError:
        logger.warning("Census geocoder returned a non-JSON body")
        raise HTTPException(status_code=502, detail="The address service is unavailable right now.")

    result = parse_census_geographies(payload)
    if result is None:
        raise HTTPException(status_code=404, detail="We could not match that address.")
    return result
