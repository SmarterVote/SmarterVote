"""Tests for the local-worker queue processor (no-handoff execution)."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _fs_mock(item_data: dict):
    """Minimal Firestore mock for worker queue and race state."""
    db = MagicMock()
    state = dict(item_data)

    queue_doc = MagicMock()
    queue_doc.exists = True
    queue_doc.to_dict.side_effect = lambda: dict(state)
    item_ref = MagicMock()
    item_ref.get.return_value = queue_doc
    item_ref.update.side_effect = lambda u: state.update(u)

    run_doc = MagicMock()
    run_doc.exists = False
    run_ref = MagicMock()
    run_ref.get.return_value = run_doc

    race_ref = MagicMock()
    race_doc = MagicMock()
    race_doc.exists = True
    race_doc.to_dict.return_value = {"current_run_id": item_data.get("run_id"), "status": "running"}
    race_ref.get.return_value = race_doc

    def _collection(name):
        coll = MagicMock()
        coll.document.return_value = {"pipeline_queue": item_ref, "pipeline_runs": run_ref, "races": race_ref}[name]
        return coll

    db.collection.side_effect = _collection

    transaction = MagicMock()

    def _tx_update(ref, update):
        if ref is item_ref:
            # Route transactional writes through item_ref.update so tests can
            # assert on every queue-item write in one place.
            item_ref.update(update)

    transaction.update.side_effect = _tx_update
    db.transaction.return_value = transaction

    return db, item_ref, run_ref, race_ref


@pytest.mark.asyncio
async def test_process_uses_far_future_deadline_and_completes():
    """The worker must run with a far-future deadline (so no handoff) and finalize."""
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-1", "options": {"cheap_mode": True}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)
    captured = {}

    async def fake_run(race_id, run_id, options, existing_data):
        captured["options"] = dict(options)

    with patch.object(qp, "_run_agent", side_effect=fake_run):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-1", item, "owner-1")

    # Far-future deadline means _maybe_handoff/PipelineWorkRemaining never fire.
    assert captured["options"]["deadline_at"] > time.time() + 3600
    assert captured["options"]["run_id"] == "run-1"
    assert captured["options"]["queue_item_id"] == "item-1"

    item_updates = [c.args[0] for c in item_ref.update.call_args_list]
    assert any(u.get("status") == "completed" for u in item_updates)
    race_sets = [c.args[0] for c in race_ref.set.call_args_list]
    assert any(u.get("status") == "draft" and u.get("current_run_id") is None for u in race_sets)


@pytest.mark.asyncio
async def test_process_follows_handoff_in_process_instead_of_failing():
    """A HandoffTriggered (e.g. from unconditional continue_incomplete_work retry
    bookkeeping) must be followed in-process, not treated as fatal — otherwise the
    far-future deadline the worker exists to provide is pointless and completed
    research work gets discarded."""
    from pipeline_client.backend import queue_processor as qp
    from pipeline_client.backend.handlers.agent import HandoffTriggered

    item = {
        "race_id": "ca-house-01-2026",
        "run_id": "run-3",
        "options": {"cheap_mode": True, "save_artifact": False},
    }
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    cont_doc = MagicMock()
    cont_doc.exists = True
    cont_doc.to_dict.return_value = {
        "options": {"cheap_mode": True, "enabled_steps": ["issues"], "is_continuation": True},
        "existing_data_gcs_path": None,
    }
    cont_ref = MagicMock()
    cont_ref.get.return_value = cont_doc

    def _pipeline_queue_document(doc_id):
        if doc_id == "cont-1":
            return cont_ref
        return item_ref

    db.collection.side_effect = None

    def _collection(name):
        if name == "pipeline_queue":
            m = MagicMock()
            m.document.side_effect = _pipeline_queue_document
            return m
        return {"pipeline_runs": run_ref, "races": race_ref}[name]

    db.collection.side_effect = _collection

    calls = []

    async def fake_run(race_id, run_id, options, existing_data):
        calls.append(dict(options))
        if len(calls) == 1:
            raise HandoffTriggered("cont-1", ["issues"], run_id)

    with (
        patch.object(qp, "_run_agent", side_effect=fake_run),
        patch("pipeline_client.backend.storage.save_artifact") as save_artifact,
    ):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-1", item, "owner-1")

    assert len(calls) == 2, "must retry in-process after the handoff instead of giving up"
    assert calls[1]["enabled_steps"] == ["issues"], "must resume with the continuation's own options"
    cont_ref.delete.assert_called_once()
    save_artifact.assert_not_called(), "a continuation must not override the caller's artifact preference"

    item_updates = [c.args[0] for c in item_ref.update.call_args_list]
    assert any(u.get("status") == "completed" for u in item_updates)
    assert not any(u.get("status") == "failed" for u in item_updates)


@pytest.mark.asyncio
async def test_process_marks_failed_on_agent_error():
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-2", "options": {}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def boom(*_a):
        raise RuntimeError("boom")

    with patch.object(qp, "_run_agent", side_effect=boom):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-2", item, "owner-2")

    item_updates = [c.args[0] for c in item_ref.update.call_args_list]
    failed = [u for u in item_updates if u.get("status") == "failed"]
    assert failed and "boom" in (failed[-1].get("error") or "")

    # run_health must always be attached on failure too — it's the taxonomy-classified
    # verdict, distinct from the free-text `error` string.
    run_updates = [c.args[0] for c in run_ref.update.call_args_list]
    failed_run_updates = [u for u in run_updates if u.get("status") == "failed"]
    assert failed_run_updates
    run_health = failed_run_updates[-1]["run_health"]
    assert run_health["status"] == "failed"
    assert run_health["reasons"] == ["unknown_error"]


@pytest.mark.asyncio
async def test_process_records_attached_provider_cost_when_post_agent_save_fails():
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-save-failed", "options": {"cheap_mode": True}}
    db, _item_ref, _run_ref, _race_ref = _fs_mock(item)
    metrics_store = MagicMock()
    metrics_store.record_run = AsyncMock()
    error = ValueError("draft save rejected")
    error.pipeline_agent_metrics = {
        "prompt_tokens": 1200,
        "completion_tokens": 300,
        "total_tokens": 1500,
        "cost_usd": 0.014,
        "cost_source": "provider",
        "serper_calls": 2,
        "search_calls": 2,
    }

    with (
        patch.object(qp, "_run_agent", new_callable=AsyncMock, side_effect=error),
        patch("pipeline_client.backend.pipeline_metrics.get_pipeline_metrics_store", return_value=metrics_store),
    ):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-save-failed", item, "owner-save-failed")

    metrics_store.record_run.assert_awaited_once()
    args = metrics_store.record_run.await_args.args
    assert args[:2] == ("run-save-failed", "ca-house-01-2026")
    assert args[2] == error.pipeline_agent_metrics
    assert args[3] == "failed"


@pytest.mark.asyncio
async def test_process_persists_run_health_from_successful_agent_result():
    """A run can finish without raising while still carrying a degraded/failed
    run_health verdict (e.g. review didn't pass) — that verdict must survive
    onto the pipeline_runs doc even though `status` stays "completed"."""
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-4", "options": {"cheap_mode": True}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    run_health_payload = {
        "status": "degraded",
        "reasons": ["step_no_data"],
        "step_failures": [{"step": "finance", "reason": "step_no_data", "detail": None}],
        "summary": "finance: step_no_data",
    }

    async def fake_run(race_id, run_id, options, existing_data):
        return {"race_id": race_id, "run_health": run_health_payload, "status": "draft"}

    with patch.object(qp, "_run_agent", side_effect=fake_run):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-4", item, "owner-4")

    item_updates = [c.args[0] for c in item_ref.update.call_args_list]
    assert any(u.get("status") == "completed" for u in item_updates)

    run_updates = [c.args[0] for c in run_ref.update.call_args_list]
    completed_run_updates = [u for u in run_updates if u.get("status") == "completed"]
    assert completed_run_updates
    assert completed_run_updates[-1]["run_health"] == run_health_payload


@pytest.mark.asyncio
async def test_process_saves_requested_artifact_and_persists_id():
    from pipeline_client.backend import queue_processor as qp

    item = {
        "race_id": "ca-house-01-2026",
        "run_id": "run-artifact",
        "options": {"cheap_mode": True, "save_artifact": True},
    }
    db, item_ref, run_ref, _race_ref = _fs_mock(item)
    result = {"race_id": item["race_id"], "status": "draft", "agent_logs": [{"message": "large"}]}

    with (
        patch.object(qp, "_run_agent", AsyncMock(return_value=result)),
        patch("pipeline_client.backend.storage.new_artifact_id", return_value="artifact-queue"),
        patch("pipeline_client.backend.storage.save_artifact") as save_artifact,
    ):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-artifact", item, "owner-artifact")

    artifact_payload = save_artifact.call_args.args[1]
    assert artifact_payload["run_id"] == "run-artifact"
    assert artifact_payload["run_started_utc"]
    assert artifact_payload["output"]["agent_log_count"] == 1
    assert "agent_logs" not in artifact_payload["output"]
    assert "deadline_at" not in artifact_payload["options"]
    assert any(update.get("artifact_id") == "artifact-queue" for update in (c.args[0] for c in item_ref.update.call_args_list))
    assert any(update.get("artifact_id") == "artifact-queue" for update in (c.args[0] for c in run_ref.update.call_args_list))


@pytest.mark.asyncio
async def test_process_can_disable_artifact_save():
    from pipeline_client.backend import queue_processor as qp

    item = {
        "race_id": "ca-house-01-2026",
        "run_id": "run-no-artifact",
        "options": {"cheap_mode": True, "save_artifact": False},
    }
    db, _item_ref, run_ref, _race_ref = _fs_mock(item)

    with (
        patch.object(qp, "_run_agent", AsyncMock(return_value={"status": "draft"})),
        patch("pipeline_client.backend.storage.save_artifact") as save_artifact,
    ):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-no-artifact", item, "owner-no-artifact")

    save_artifact.assert_not_called()
    completed = [c.args[0] for c in run_ref.update.call_args_list if c.args[0].get("status") == "completed"]
    assert completed[-1]["artifact_id"] is None


@pytest.mark.asyncio
async def test_process_artifact_save_failure_is_non_fatal():
    from pipeline_client.backend import queue_processor as qp

    item = {
        "race_id": "ca-house-01-2026",
        "run_id": "run-artifact-failure",
        "options": {"cheap_mode": True, "save_artifact": True},
    }
    db, item_ref, run_ref, _race_ref = _fs_mock(item)

    with (
        patch.object(qp, "_run_agent", AsyncMock(return_value={"status": "draft"})),
        patch("pipeline_client.backend.storage.save_artifact", side_effect=RuntimeError("gcs unavailable")),
    ):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-artifact-failure", item, "owner-artifact-failure")

    run_updates = [call.args[0] for call in run_ref.update.call_args_list]
    completed = [update for update in run_updates if update.get("status") == "completed"]
    assert completed[-1]["artifact_id"] is None
    assert not any(update.get("status") == "failed" for update in run_updates)
    item_updates = [call.args[0] for call in item_ref.update.call_args_list]
    assert any(update.get("status") == "completed" for update in item_updates)


@pytest.mark.asyncio
async def test_process_marks_cancelled_run_health_on_agent_cancelled():
    from pipeline_client.backend import queue_processor as qp
    from pipeline_client.backend.handlers.agent import AgentCancelled

    item = {"race_id": "ca-house-01-2026", "run_id": "run-5", "options": {}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def cancelled(*_a):
        raise AgentCancelled("cancelled by admin")

    with patch.object(qp, "_run_agent", side_effect=cancelled):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-5", item, "owner-5")

    run_updates = [c.args[0] for c in run_ref.update.call_args_list]
    cancelled_updates = [u for u in run_updates if u.get("status") == "cancelled"]
    assert cancelled_updates
    assert cancelled_updates[-1]["run_health"]["reasons"] == ["cancelled"]


@pytest.mark.asyncio
async def test_process_records_live_provider_cost_when_cancelled():
    from pipeline_client.agent.cost import _cost_ctx
    from pipeline_client.backend import queue_processor as qp
    from pipeline_client.backend.handlers.agent import AgentCancelled

    item = {
        "race_id": "ca-house-01-2026",
        "run_id": "run-cost-cancelled",
        "options": {"cheap_mode": True, "research_model": "test/model"},
    }
    db, _item_ref, _run_ref, _race_ref = _fs_mock(item)
    metrics_store = MagicMock()
    metrics_store.record_run = AsyncMock()

    async def cancelled(*_args):
        _cost_ctx.set(
            {
                "prompt_tokens": 1200,
                "completion_tokens": 300,
                "provider_cost_usd": 0.012,
                "priced_calls": 2,
                "unpriced_calls": 0,
                "serper_calls": 2,
                "model_breakdown": {"test/model": {"prompt_tokens": 1200, "completion_tokens": 300}},
                "phase_breakdown": {"discovery": {"prompt_tokens": 1200, "completion_tokens": 300}},
            }
        )
        raise AgentCancelled("cancelled by admin")

    with (
        patch.object(qp, "_run_agent", side_effect=cancelled),
        patch("pipeline_client.backend.pipeline_metrics.get_pipeline_metrics_store", return_value=metrics_store),
    ):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-cost", item, "owner-cost")

    metrics_store.record_run.assert_awaited_once()
    args = metrics_store.record_run.await_args.args
    assert args[:4] == ("run-cost-cancelled", "ca-house-01-2026", args[2], "cancelled")
    assert args[2]["prompt_tokens"] == 1200
    assert args[2]["completion_tokens"] == 300
    assert args[2]["cost_usd"] == pytest.approx(0.014)
    assert args[2]["cost_source"] == "provider"


def test_claim_item_local_claims_pending_local():
    from pipeline_client.backend import queue_processor as qp

    item = {"status": "pending", "runner": "local", "race_id": "x", "run_id": "r"}
    db, item_ref, _run_ref, _race_ref = _fs_mock(item)

    claimed = qp.claim_item(db, item_ref, "owner-1", "local")

    assert claimed is not None
    claim_updates = [c.args[1] for c in db.transaction.return_value.update.call_args_list]
    assert any(u.get("status") == "running" and u.get("lease_owner") == "owner-1" for u in claim_updates)


def test_claim_item_local_skips_non_local():
    from pipeline_client.backend import queue_processor as qp

    item = {"status": "pending", "runner": "cloud_run", "race_id": "x", "run_id": "r"}
    db, item_ref, _run_ref, _race_ref = _fs_mock(item)

    assert qp.claim_item(db, item_ref, "owner-1", "local") is None
    claim_updates = [c.args[1] for c in db.transaction.return_value.update.call_args_list]
    assert not any(u.get("status") == "running" for u in claim_updates)


def test_claim_item_supports_cloud_run_runner():
    from pipeline_client.backend import queue_processor as qp

    item = {"status": "pending", "runner": "cloud_run", "race_id": "x", "run_id": "r"}
    db, item_ref, _run_ref, _race_ref = _fs_mock(item)

    assert qp.claim_item(db, item_ref, "job-owner", "cloud_run") is not None


def test_pending_items_filters_runner_and_status_in_firestore():
    from pipeline_client import worker

    db = MagicMock()
    query = MagicMock()
    db.collection.return_value = query
    query.where.return_value = query
    query.order_by.return_value = query
    query.limit.return_value = query
    query.stream.return_value = []

    assert worker._pending_items(db, "local", limit=2) == []
    filters = [call.kwargs["filter"] for call in query.where.call_args_list]
    assert [(flt.field_path, flt.op_string, flt.value) for flt in filters] == [
        ("runner", "==", "local"),
        ("status", "==", "pending"),
        ("runner", "==", "local"),
        ("status", "==", "running"),
    ]


@pytest.mark.asyncio
async def test_process_returns_the_auth_failure_reason_when_the_agent_raises():
    """The worker halts on this value, so it must escape the Firestore bookkeeping.

    process_claimed_item deliberately absorbs run failures into Firestore state
    instead of raising, which is why the reason is returned rather than thrown.
    """
    from pipeline_client.agent.errors import PermanentProviderError
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-auth", "options": {}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def out_of_credit(*_a):
        raise PermanentProviderError("HTTP 402", provider="openrouter", code="auth_failure")

    with patch.object(qp, "_run_agent", side_effect=out_of_credit):
        reason = await qp.process_claimed_item(db, MagicMock(), "bucket", "item-auth", item, "owner-auth")

    assert reason == "provider_auth_failure"


@pytest.mark.asyncio
async def test_process_returns_the_auth_reason_from_an_unhealthy_completed_run():
    """Most steps absorb provider failures into run_health rather than raising, so a
    credit outage frequently shows up as a `completed` run with a failed verdict."""
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-health", "options": {"save_artifact": False}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def fake_run(race_id, run_id, options, existing_data):
        return {
            "run_health": {
                "status": "failed",
                # Ordered so the auth reason is not first: the downstream noise a
                # dead provider generates must not mask the cause.
                "reasons": ["step_no_data", "provider_auth_failure"],
                "step_failures": [],
            }
        }

    with patch.object(qp, "_run_agent", side_effect=fake_run):
        reason = await qp.process_claimed_item(db, MagicMock(), "bucket", "item-health", item, "owner-health")

    assert reason == "provider_auth_failure"


@pytest.mark.asyncio
async def test_process_returns_none_for_a_healthy_run():
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-ok", "options": {"save_artifact": False}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def fake_run(race_id, run_id, options, existing_data):
        return {"run_health": {"status": "healthy", "reasons": [], "step_failures": []}}

    with patch.object(qp, "_run_agent", side_effect=fake_run):
        reason = await qp.process_claimed_item(db, MagicMock(), "bucket", "item-ok", item, "owner-ok")

    assert reason is None


@pytest.mark.asyncio
async def test_process_force_removed_item_finalizes_run_as_cancelled():
    """A force-deleted queue doc must not crash the worker or leave the run 'running'."""
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-del", "options": {"save_artifact": False}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def deleted_mid_run(*_a):
        item_ref.get.return_value.exists = False

    with patch.object(qp, "_run_agent", side_effect=deleted_mid_run):
        reason = await qp.process_claimed_item(db, MagicMock(), "bucket", "item-del", item, "owner-1")

    assert reason == "cancelled"
    item_ref.update.assert_not_called()
    run_statuses = [c.args[0].get("status") for c in run_ref.update.call_args_list]
    assert run_statuses == ["cancelled"]


@pytest.mark.asyncio
async def test_process_does_not_overwrite_admin_cancel_with_completed():
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-c", "options": {"save_artifact": False}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def cancelled_during_save(*_a):
        item_ref.update({"status": "cancelled", "lease_owner": None})
        item_ref.update.reset_mock()

    with patch.object(qp, "_run_agent", side_effect=cancelled_during_save):
        reason = await qp.process_claimed_item(db, MagicMock(), "bucket", "item-c", item, "owner-1")

    assert reason == "cancelled"
    assert not any(c.args[0].get("status") == "completed" for c in item_ref.update.call_args_list)
    run_statuses = [c.args[0].get("status") for c in run_ref.update.call_args_list]
    assert "completed" not in run_statuses and run_statuses[-1] == "cancelled"


@pytest.mark.asyncio
async def test_process_skips_terminal_writes_after_losing_lease():
    from pipeline_client.backend import queue_processor as qp

    item = {"race_id": "ca-house-01-2026", "run_id": "run-l", "options": {"save_artifact": False}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    async def reclaimed(*_a):
        item_ref.update({"status": "running", "lease_owner": "other-worker"})
        item_ref.update.reset_mock()
        raise RuntimeError("boom")

    with patch.object(qp, "_run_agent", side_effect=reclaimed):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-l", item, "owner-1")

    item_ref.update.assert_not_called()
    assert not any(c.args[0].get("status") in ("failed", "completed") for c in run_ref.update.call_args_list)


def test_lease_heartbeat_flags_lost_lease_for_agent(monkeypatch):
    from pipeline_client.backend import queue_processor as qp

    item = {"status": "running", "lease_owner": "other-worker"}
    db, item_ref, _run_ref, _race_ref = _fs_mock(item)
    monkeypatch.setattr(qp, "_LEASE_RENEW_SECONDS", 0.01)

    stop, thread = qp._start_lease_heartbeat(db, item_ref, "owner-1", "item-hb")
    thread.join(timeout=2)
    try:
        assert qp.lease_lost("item-hb")
    finally:
        stop.set()
        qp._LOST_LEASE_ITEMS.discard("item-hb")


@pytest.mark.asyncio
async def test_process_follows_handoff_with_in_memory_checkpoint_when_gcs_save_failed():
    """A handoff whose GCS checkpoint failed must resume from the in-memory data, not the stale draft."""
    from pipeline_client.backend import queue_processor as qp
    from pipeline_client.backend.handlers.agent import HandoffTriggered

    item = {"race_id": "ca-house-01-2026", "run_id": "run-ck", "options": {"save_artifact": False}}
    db, item_ref, run_ref, race_ref = _fs_mock(item)
    cont_doc = MagicMock()
    cont_doc.exists = True
    cont_doc.to_dict.return_value = {"options": {"enabled_steps": ["review"]}, "existing_data_gcs_path": None}
    cont_ref = MagicMock()
    cont_ref.get.return_value = cont_doc

    def _collection(name):
        if name == "pipeline_queue":
            m = MagicMock()
            m.document.side_effect = lambda doc_id: cont_ref if doc_id == "cont-ck" else item_ref
            return m
        return {"pipeline_runs": run_ref, "races": race_ref}[name]

    db.collection.side_effect = _collection
    checkpoint = {"id": "ca-house-01-2026", "candidates": [{"name": "A", "issues": {"economy": "done"}}]}
    seen = []

    async def fake_run(race_id, run_id, options, existing_data):
        seen.append(existing_data)
        if len(seen) == 1:
            raise HandoffTriggered("cont-ck", ["review"], run_id, checkpoint_data=checkpoint)

    with patch.object(qp, "_run_agent", side_effect=fake_run):
        await qp.process_claimed_item(db, MagicMock(), "bucket", "item-ck", item, "owner-1")

    assert seen[1] == checkpoint


def test_claim_item_fails_item_and_run_after_max_expired_leases(monkeypatch):
    """An item whose lease keeps expiring (crash/OOM/hang) must not be re-leased forever."""
    from datetime import datetime, timedelta, timezone

    from pipeline_client.backend import queue_processor as qp

    monkeypatch.setattr(qp, "_MAX_LEASE_ATTEMPTS", 3)
    expired = datetime.now(timezone.utc) - timedelta(minutes=5)
    item = {
        "status": "running",
        "runner": "local",
        "race_id": "x",
        "run_id": "r",
        "lease_attempts": 3,
        "lease_expires_at": expired,
    }
    db, item_ref, run_ref, race_ref = _fs_mock(item)

    assert qp.claim_item(db, item_ref, "owner-1", "local") is None
    claim_updates = [c.args[1] for c in db.transaction.return_value.update.call_args_list]
    assert any(u.get("status") == "failed" and "expired lease" in u.get("error", "") for u in claim_updates)
    assert not any(u.get("status") == "running" for u in claim_updates)
    run_sets = [c.args[0] for c in run_ref.set.call_args_list]
    assert any(u.get("status") == "failed" for u in run_sets)
    race_sets = [c.args[0] for c in race_ref.set.call_args_list]
    assert any(u.get("status") == "failed" and u.get("current_run_id") is None for u in race_sets)


def test_claim_item_recovers_expired_lease_below_cap(monkeypatch):
    from datetime import datetime, timedelta, timezone

    from pipeline_client.backend import queue_processor as qp

    monkeypatch.setattr(qp, "_MAX_LEASE_ATTEMPTS", 3)
    item = {
        "status": "running",
        "runner": "local",
        "race_id": "x",
        "run_id": "r",
        "lease_attempts": 2,
        "lease_expires_at": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    db, item_ref, _run_ref, _race_ref = _fs_mock(item)

    assert qp.claim_item(db, item_ref, "owner-1", "local") is not None
    claim_updates = [c.args[1] for c in db.transaction.return_value.update.call_args_list]
    assert any(u.get("status") == "running" and "recovered_at" in u for u in claim_updates)


def test_hard_deadline_only_applies_to_cloud_run(monkeypatch):
    from pipeline_client.backend import queue_processor as qp

    monkeypatch.delenv("CLOUD_RUN_JOB", raising=False)
    monkeypatch.delenv("WORKER_TASK_TIMEOUT_SECONDS", raising=False)
    assert qp.hard_deadline_at("local") is None

    monkeypatch.setattr(qp, "_PROCESS_STARTED_AT", 1000.0)
    monkeypatch.setattr(qp, "_CLOUD_RUN_DEADLINE_BUFFER_SECONDS", 1800)
    assert qp.hard_deadline_at("cloud_run") == 1000.0 + 12 * 3600 - 1800

    monkeypatch.setenv("WORKER_TASK_TIMEOUT_SECONDS", "7200s")
    assert qp.hard_deadline_at("cloud_run") == 1000.0 + 7200 - 1800


@pytest.mark.asyncio
async def test_cloud_run_deadline_is_below_job_timeout_and_fails_cleanly_on_handoff(monkeypatch):
    from pipeline_client.backend import queue_processor as qp
    from pipeline_client.backend.handlers.agent import HandoffTriggered

    monkeypatch.setattr(qp, "hard_deadline_at", lambda runner: time.time() - 1 if runner == "cloud_run" else None)
    item = {"race_id": "ca-house-01-2026", "run_id": "run-9", "options": {"save_artifact": False}}
    db, item_ref, run_ref, _race_ref = _fs_mock(item)
    calls = []

    async def fake_run(race_id, run_id, options, existing_data):
        calls.append(options["deadline_at"])
        raise HandoffTriggered("cont-9", ["issues"], run_id)

    with patch.object(qp, "_run_agent", side_effect=fake_run):
        reason = await qp.process_claimed_item(db, MagicMock(), "bucket", "item-9", item, "owner", runner="cloud_run")

    assert len(calls) == 1, "must not follow a deadline handoff past the job timeout"
    assert calls[0] < time.time()
    assert reason == "budget_exhausted"
    item_updates = [c.args[0] for c in item_ref.update.call_args_list]
    assert any(u.get("status") == "failed" and "task deadline" in u.get("error", "") for u in item_updates)
