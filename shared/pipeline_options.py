"""Canonical pipeline run option schemas shared by APIs and workers."""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from shared.model_catalog import MODEL_CATALOG, normalize_model_id
from shared.pipeline_config import (
    normalize_model_profile,
    normalize_pipeline_steps,
    normalize_review_providers,
    validate_model_override_keys,
)


def validate_known_model_id(value: Optional[str], *, field: str = "model") -> Optional[str]:
    """Reject model IDs that are not in ``shared.model_catalog`` (after legacy-alias mapping).

    An unknown slug would otherwise be accepted at queue time and fail only
    mid-run at OpenRouter, after paid work has already been spent.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        return value  # blank means "no override"; resolution treats it as unset
    normalized = normalize_model_id(value)
    if normalized not in MODEL_CATALOG:
        raise ValueError(f"Unknown {field} {value!r}; must be a model in shared/model_catalog.py")
    return value


class PipelineRunOptions(BaseModel):
    """Wire-level options where ``None`` means the caller did not specify a value."""

    model_config = ConfigDict(protected_namespaces=())

    cheap_mode: Optional[bool] = None
    save_artifact: Optional[bool] = None
    note: Optional[str] = None
    goal: Optional[str] = None
    force_fresh: Optional[bool] = None
    allow_fast_no_change: Optional[bool] = None
    baseline_source: Optional[Literal["latest", "published"]] = None
    resume_partial: Optional[bool] = None
    research_model: Optional[str] = None
    claude_model: Optional[str] = None
    gemini_model: Optional[str] = None
    grok_model: Optional[str] = None
    model_profile: Optional[str] = None
    model_overrides: Optional[Dict[str, str]] = None
    review_providers: Optional[List[str]] = None
    enabled_steps: Optional[List[str]] = None
    max_candidates: Optional[int] = None
    target_no_info: Optional[bool] = None
    candidate_names: Optional[List[str]] = None
    runner: Optional[Literal["cloud_run", "local"]] = None
    debug_mode: Optional[bool] = None

    @field_validator("enabled_steps")
    @classmethod
    def validate_enabled_steps(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        return normalize_pipeline_steps(value)

    @field_validator("max_candidates")
    @classmethod
    def validate_max_candidates(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value < 1:
            raise ValueError("max_candidates must be at least 1 when provided")
        return value

    @field_validator("model_overrides")
    @classmethod
    def validate_model_overrides(cls, value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        overrides = validate_model_override_keys(value)
        if overrides is None:
            return None
        return {
            role: validate_known_model_id(model, field=f"model_overrides[{role!r}]") or model
            for role, model in overrides.items()
        }

    @field_validator("research_model", "claude_model", "gemini_model", "grok_model")
    @classmethod
    def validate_model_ids(cls, value: Optional[str], info) -> Optional[str]:
        return validate_known_model_id(value, field=info.field_name)

    @field_validator("candidate_names")
    @classmethod
    def normalize_candidate_names(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        normalized = [name.strip() for name in value if isinstance(name, str) and name.strip()]
        return list(dict.fromkeys(normalized)) or None

    @field_validator("model_profile")
    @classmethod
    def validate_model_profile(cls, value: Optional[str]) -> Optional[str]:
        return normalize_model_profile(value)

    @field_validator("review_providers")
    @classmethod
    def validate_review_providers(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        return normalize_review_providers(value)

    @model_validator(mode="after")
    def validate_step_dependencies(self) -> "PipelineRunOptions":
        if self.enabled_steps and "iteration" in self.enabled_steps and "review" not in self.enabled_steps:
            raise ValueError("'iteration' requires 'review' in enabled_steps")
        return self


class ResolvedPipelineRunOptions(PipelineRunOptions):
    """Worker-facing options with execution defaults applied."""

    cheap_mode: bool = True
    save_artifact: bool = True
    force_fresh: bool = False
    allow_fast_no_change: bool = False
    baseline_source: Literal["latest", "published"] = "latest"
    resume_partial: bool = False
    target_no_info: bool = False
