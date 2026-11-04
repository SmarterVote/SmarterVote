"""Static copies of the live results and live forecast feeds.

The races API writes ``results-live.json`` and ``forecast-live.json`` to a
public bucket whenever results are published or the published races change, so
browsers poll a static object instead of a Cloudflare Function. Writing is
best-effort: a failed upload leaves the previous object in place (the site
keeps showing the last copy with its own as-of time), and nothing here raises
into the publish request that triggered it.
"""

import json
import logging
import os
from typing import Any, Dict, Optional

import gcs_helpers

logger = logging.getLogger(__name__)

RESULTS_OBJECT = "results-live.json"
FORECAST_OBJECT = "forecast-live.json"
CACHE_CONTROL = "public, max-age=30"


def live_feeds_bucket() -> str:
    """The public bucket's name, or empty when static feeds are not configured."""
    return os.getenv("LIVE_FEEDS_BUCKET", "").strip()


def write_feed(name: str, payload: Dict[str, Any], bucket_name: Optional[str] = None) -> bool:
    """Upload one feed. Returns True on success; on failure the old object stays in the bucket.

    Every trigger writes, even when the content is unchanged: triggers are
    rare (a publish, a few times an hour), and a per-instance "unchanged"
    check could skip a write after another instance replaced the object.
    """
    bucket_name = bucket_name or live_feeds_bucket()
    if not bucket_name:
        return False
    try:
        client = gcs_helpers._get_gcs_admin()
        if client is None:
            raise RuntimeError("GCS client is unavailable")
        blob = client.bucket(bucket_name).blob(name)
        blob.cache_control = CACHE_CONTROL
        blob.upload_from_string(json.dumps(payload), content_type="application/json")
    except Exception:
        logger.exception("Live feed %s was not written; the previous copy stays in place", name)
        return False
    return True


def write_live_feeds(results: Dict[str, Any], forecast: Dict[str, Any]) -> Dict[str, bool]:
    """Write both feeds; one failing does not stop the other."""
    bucket_name = live_feeds_bucket()
    if not bucket_name:
        return {}
    return {
        RESULTS_OBJECT: write_feed(RESULTS_OBJECT, results, bucket_name),
        FORECAST_OBJECT: write_feed(FORECAST_OBJECT, forecast, bucket_name),
    }
