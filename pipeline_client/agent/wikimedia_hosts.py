"""Which hosts serve Wikimedia Commons files.

Kept in its own module so both ``images`` and ``image_denylist`` (which
``images`` imports) can share one definition without a circular import.
"""

from typing import Any
from urllib.parse import urlparse

# Hosts that serve Wikimedia Commons files. Wikipedia's page-summary API also
# hands out thumb.wikimedia.org thumbnails (va-house-04-2026 took the actress
# Kristen Bell's portrait for Joan E. Bell that way), so both get the name check.
WIKIMEDIA_FILE_HOSTS = frozenset({"upload.wikimedia.org", "thumb.wikimedia.org"})


def is_wikimedia_file_host(url: Any) -> bool:
    """True when *url* is served by a Wikimedia file host (exact parsed-host match).

    Every check that means "this is a Commons file" must accept all of
    ``WIKIMEDIA_FILE_HOSTS`` alike; a check that names only upload.wikimedia.org
    lets the same file through on thumb.wikimedia.org. ``commons.wikimedia.org``
    serves file *pages*, not files, and is deliberately not included.
    """
    if not isinstance(url, str) or not url:
        return False
    try:
        host = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return False
    return host in WIKIMEDIA_FILE_HOSTS
