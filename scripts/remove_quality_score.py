"""Remove legacy ``quality_score`` fields from local JSON, Firestore, and GCS.

The canonical quality data is ``quality_grade`` on race metadata and
``validation_grade`` inside RaceJSON. This script only removes exact
``quality_score`` keys; similarly named source-extraction metrics are preserved.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JSON_ROOTS = [
    ROOT / "data",
    ROOT / "services" / "races-api" / "data",
]


def strip_quality_score(value: Any) -> tuple[Any, int]:
    if isinstance(value, dict):
        removed = 1 if "quality_score" in value else 0
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if key == "quality_score":
                continue
            cleaned_item, item_removed = strip_quality_score(item)
            cleaned[key] = cleaned_item
            removed += item_removed
        return cleaned, removed
    if isinstance(value, list):
        cleaned_list = []
        removed = 0
        for item in value:
            cleaned_item, item_removed = strip_quality_score(item)
            cleaned_list.append(cleaned_item)
            removed += item_removed
        return cleaned_list, removed
    return value, 0


def iter_json_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_file() and path.suffix == ".json":
            files.append(path)
        elif path.exists():
            files.extend(sorted(path.rglob("*.json")))
    return files


def clean_local_json(paths: list[Path], apply: bool) -> int:
    changed = 0
    for path in iter_json_files(paths):
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
        except Exception as exc:
            print(f"skip {path}: {exc}")
            continue

        cleaned, removed = strip_quality_score(data)
        if not removed:
            continue

        changed += 1
        print(f"{'clean' if apply else 'would clean'} {path.relative_to(ROOT)} ({removed} field{'s' if removed != 1 else ''})")
        if apply:
            path.write_text(json.dumps(cleaned, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def clean_firestore(project: str | None, apply: bool) -> int:
    from google.cloud import firestore  # type: ignore
    from google.cloud.firestore_v1 import DELETE_FIELD  # type: ignore

    db = firestore.Client(project=project) if project else firestore.Client()
    changed = 0
    for doc in db.collection("races").stream():
        data = doc.to_dict() or {}
        if "quality_score" not in data:
            continue
        changed += 1
        print(f"{'delete' if apply else 'would delete'} Firestore races/{doc.id}.quality_score")
        if apply:
            doc.reference.update({"quality_score": DELETE_FIELD})
    return changed


def clean_gcs(bucket_name: str, apply: bool) -> int:
    from google.cloud import storage  # type: ignore

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    changed = 0
    for prefix in ("races/", "drafts/", "retired/"):
        for blob in bucket.list_blobs(prefix=prefix):
            if not blob.name.endswith(".json"):
                continue
            try:
                data = json.loads(blob.download_as_text())
            except Exception as exc:
                print(f"skip gs://{bucket_name}/{blob.name}: {exc}")
                continue
            cleaned, removed = strip_quality_score(data)
            if not removed:
                continue
            changed += 1
            print(
                f"{'clean' if apply else 'would clean'} gs://{bucket_name}/{blob.name} ({removed} field{'s' if removed != 1 else ''})"
            )
            if apply:
                blob.upload_from_string(
                    json.dumps(cleaned, indent=2, ensure_ascii=False) + "\n",
                    content_type="application/json",
                )
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write changes. Without this, only reports what would change.")
    parser.add_argument(
        "--json-root", action="append", type=Path, help="Local JSON file or directory to clean. May be repeated."
    )
    parser.add_argument("--firestore-project", help="Clean quality_score from Firestore races collection.")
    parser.add_argument("--gcs-bucket", help="Clean quality_score from GCS races/, drafts/, and retired/ JSON blobs.")
    args = parser.parse_args()

    local_roots = args.json_root or DEFAULT_JSON_ROOTS
    total = clean_local_json(local_roots, args.apply)
    if args.firestore_project is not None:
        total += clean_firestore(args.firestore_project or None, args.apply)
    if args.gcs_bucket:
        total += clean_gcs(args.gcs_bucket, args.apply)

    print(f"{'changed' if args.apply else 'would change'} {total} record/file set{'s' if total != 1 else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
