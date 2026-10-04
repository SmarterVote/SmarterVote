import os

from constants import DEFAULT_DATA_DIR

DATA_DIR = DEFAULT_DATA_DIR


def is_production() -> bool:
    """True on the deployed service.

    The deployed stack's ``ENVIRONMENT`` is currently ``dev`` (resource names
    carry it), so the reliable production signal is ``K_SERVICE``, which Cloud
    Run sets on every revision. An explicit ``ENVIRONMENT``/``ENV`` of
    ``prod``/``production`` also counts. Read at call time so tests can toggle it.
    """
    env = (os.getenv("ENVIRONMENT") or os.getenv("ENV") or "").strip().lower()
    return env in {"prod", "production"} or bool(os.getenv("K_SERVICE"))
