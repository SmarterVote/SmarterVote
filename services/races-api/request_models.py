"""Pydantic request/response models and input validation for races-api."""

import re
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

_RACE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,99}$")


def validate_race_id(race_id: str) -> None:
    """Raise HTTP 400 if race_id doesn't match the canonical format."""
    if not _RACE_ID_RE.match(race_id):
        raise HTTPException(status_code=400, detail="Invalid race_id format")


class RunOptions(BaseModel):
    cheap_mode: Optional[bool] = None
    force_fresh: Optional[bool] = None
    enabled_steps: Optional[List[str]] = None
    research_model: Optional[str] = None
    claude_model: Optional[str] = None
    max_candidates: Optional[int] = None
    candidate_names: Optional[List[str]] = None
    target_no_info: Optional[bool] = None
    note: Optional[str] = None
    goal: Optional[str] = None


class RaceQueueRequest(BaseModel):
    race_ids: List[str]
    options: Optional[RunOptions] = None


class BatchPublishRequest(BaseModel):
    race_ids: List[str]


class AdminChatMessage(BaseModel):
    role: str
    content: str


class AdminChatRequest(BaseModel):
    messages: List[AdminChatMessage]
    race_context: Optional[List[Dict[str, Any]]] = None
