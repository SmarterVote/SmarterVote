"""Pipeline metrics, alerts, and admin-chat endpoints."""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict

import firestore_helpers
import httpx
from auth import verify_token
from fastapi import APIRouter, Depends, HTTPException
from request_models import AdminChatRequest

router = APIRouter()

_ADMIN_CHAT_MODEL = os.getenv("ADMIN_CHAT_MODEL", "gpt-4o-mini")
_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


# ---------------------------------------------------------------------------
# Pipeline metrics (token usage / cost)
# ---------------------------------------------------------------------------


@router.get("/pipeline/metrics", dependencies=[Depends(verify_token)])
async def get_pipeline_metrics(limit: int = 50) -> Dict[str, Any]:
    """Return recent pipeline run records with token usage and cost data."""
    db = firestore_helpers._get_fs()
    docs = db.collection("pipeline_runs").order_by("started_at", direction="DESCENDING").limit(limit).stream()
    records = [firestore_helpers._doc_to_plain(d) for d in docs]
    records = [r for r in records if r is not None]
    return {"records": records, "count": len(records)}


@router.get("/pipeline/metrics/summary", dependencies=[Depends(verify_token)])
async def get_pipeline_metrics_summary() -> Dict[str, Any]:
    """Return aggregate pipeline cost stats."""
    db = firestore_helpers._get_fs()
    docs = db.collection("pipeline_runs").stream()
    total_runs = 0
    total_usd = 0.0
    recent_usd = 0.0
    cutoff = datetime.now(timezone.utc).timestamp() - 30 * 86400
    for doc in docs:
        d = doc.to_dict() or {}
        total_runs += 1
        cost = d.get("cost_usd") or 0.0
        total_usd += cost
        started = d.get("started_at")
        ts = started.timestamp() if hasattr(started, "timestamp") else 0
        if ts > cutoff:
            recent_usd += cost
    avg_usd = total_usd / total_runs if total_runs > 0 else 0.0
    return {
        "total_runs": total_runs,
        "total_usd": round(total_usd, 4),
        "avg_usd": round(avg_usd, 4),
        "recent_30d_usd": round(recent_usd, 4),
    }


# ---------------------------------------------------------------------------
# Alerts (stub — placeholder for domain-aware alert rules)
# ---------------------------------------------------------------------------


@router.get("/alerts", dependencies=[Depends(verify_token)])
async def get_alerts() -> Dict[str, Any]:
    """Return active pipeline alerts (stub — expand with domain rules as needed)."""
    return {"alerts": [], "total": 0, "unacknowledged": 0}


@router.post("/alerts/{alert_id}/acknowledge", dependencies=[Depends(verify_token)])
async def ack_alert(alert_id: str) -> Dict[str, Any]:
    """Acknowledge an alert by ID."""
    return {"ok": True, "alert_id": alert_id}


@router.post("/alerts/acknowledge-all", dependencies=[Depends(verify_token)])
async def ack_all_alerts() -> Dict[str, Any]:
    """Acknowledge all currently active alerts."""
    return {"ok": True, "acknowledged_count": 0}


# ---------------------------------------------------------------------------
# Admin chat proxy
# ---------------------------------------------------------------------------


@router.post("/api/admin-chat", dependencies=[Depends(verify_token)])
async def admin_chat(request: AdminChatRequest) -> Dict[str, Any]:
    """Admin-chat endpoint — forwards messages to OpenAI with race context."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY not configured")
    model = os.getenv("ADMIN_CHAT_MODEL", "gpt-4o-mini")
    system_content = (
        "You are an AI assistant embedded in the SmarterVote admin dashboard. "
        "You help administrators review races, decide which ones need re-running, "
        "and kick off new pipeline runs with the right settings."
    )
    if request.race_context:
        system_content += f"\n\nCurrent race context (JSON):\n{json.dumps(request.race_context, indent=2)}"
    messages = [{"role": "system", "content": system_content}]
    messages += [{"role": m.role, "content": m.content} for m in request.messages]
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "messages": messages},
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
            return {"reply": reply, "model": model}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {exc.response.status_code}") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Chat unavailable: {exc}") from exc
