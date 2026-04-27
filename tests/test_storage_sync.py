import json
from datetime import datetime, timezone

from pipeline_client.backend import main as main_module
from pipeline_client.backend.models import RunInfo, RunStatus
from pipeline_client.backend.race_manager import RaceManager


def test_load_race_json_prefers_gcs_on_cloud(monkeypatch, tmp_path):
    local_dir = tmp_path / "published"
    local_dir.mkdir(parents=True)
    (local_dir / "ga-senate-2026.json").write_text(json.dumps({"id": "local"}), encoding="utf-8")

    monkeypatch.setattr(main_module.settings, "gcs_bucket", "bucket")
    monkeypatch.setattr(main_module, "_prefer_cloud_storage", lambda: True)
    monkeypatch.setattr(main_module, "_get_race_gcs", lambda race_id, prefix: {"id": f"{prefix}:{race_id}:gcs"})

    data = main_module._load_race_json("ga-senate-2026", gcs_prefix="races", local_dir=local_dir)

    assert data == {"id": "races:ga-senate-2026:gcs"}


def test_load_race_json_prefers_local_off_cloud(monkeypatch, tmp_path):
    local_dir = tmp_path / "drafts"
    local_dir.mkdir(parents=True)
    (local_dir / "ga-senate-2026.json").write_text(json.dumps({"id": "local"}), encoding="utf-8")

    monkeypatch.setattr(main_module.settings, "gcs_bucket", None)
    monkeypatch.setattr(main_module, "_prefer_cloud_storage", lambda: False)
    monkeypatch.setattr(main_module, "_get_race_gcs", lambda race_id, prefix: {"id": f"{prefix}:{race_id}:gcs"})

    data = main_module._load_race_json("ga-senate-2026", gcs_prefix="drafts", local_dir=local_dir)

    assert data == {"id": "local"}


def test_race_manager_get_run_prefers_firestore_over_local_cache():
    manager = RaceManager()

    stale_local = RunInfo(
        run_id="run-1",
        status=RunStatus.RUNNING,
        payload={"race_id": "ga-senate-2026"},
        options={},
        started_at=datetime(2026, 4, 26, 0, 0, tzinfo=timezone.utc),
        steps=[],
    )
    fresh_remote = RunInfo(
        run_id="run-1",
        status=RunStatus.CANCELLED,
        payload={"race_id": "ga-senate-2026"},
        options={},
        started_at=datetime(2026, 4, 26, 0, 0, tzinfo=timezone.utc),
        completed_at=datetime(2026, 4, 26, 0, 5, tzinfo=timezone.utc),
        steps=[],
    )
    manager._local_runs = {"ga-senate-2026": {"run-1": stale_local}}

    class FakeDoc:
        exists = True

        def to_dict(self):
            return fresh_remote.model_dump(mode="json")

    class FakeRunDoc:
        def get(self):
            return FakeDoc()

    class FakeRunsCollection:
        def document(self, run_id: str):
            assert run_id == "run-1"
            return FakeRunDoc()

    class FakeRaceDoc:
        def collection(self, name: str):
            assert name == "runs"
            return FakeRunsCollection()

    class FakeCollection:
        def document(self, race_id: str):
            assert race_id == "ga-senate-2026"
            return FakeRaceDoc()

    class FakeDb:
        def collection(self, name: str):
            assert name == "races"
            return FakeCollection()

    manager._db = FakeDb()

    result = manager.get_run("ga-senate-2026", "run-1")

    assert result is not None
    assert result.status == RunStatus.CANCELLED
