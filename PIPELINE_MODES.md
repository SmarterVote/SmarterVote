# Pipeline Modes

The SmarterVote pipeline supports local development and cloud production modes.

## Local Mode (Default)

Best for development and small-scale use.

**How it works**:
- Agent runs via `pipeline_client/backend/main.py` (FastAPI, port 8001)
- Web search results cached in SQLite (`data/cache/`)
- Published profiles written to `data/published/` as JSON files
- Drafts written to `data/drafts/` before publish
- Queue state managed in-memory (cleared on restart)
- Races API reads directly from local files
- Frontend polls the pipeline API every few seconds for progress

**Setup**:
```powershell
# Install dependencies
pip install -r requirements.txt
pip install -e shared/

# Set API keys in .env
# OPENAI_API_KEY, SERPER_API_KEY

# Start all services at once (recommended)
.\dev-start.ps1

# Or start individually:
# Pipeline backend
python -m uvicorn pipeline_client.backend.main:app --port 8001 --reload
# Races API
cd services/races-api && python main.py
```

## Cloud Function Mode (Production)

The primary cloud architecture. Admin triggers runs via `races-api`; the pipeline runs inside a gen2 Cloud Function invoked by Firestore Eventarc.

**How it works**:
- Admin queues a race via `races-api POST /queue/{race_id}` (X-Admin-Key authenticated)
- `races-api` creates a document in Firestore `pipeline_queue`
- Firestore Eventarc trigger invokes the gen2 Cloud Function (`functions/agent/main.py`)
- CF imports `AgentHandler` from `pipeline_client.backend.handlers.agent`
- Agent runs all pipeline steps; progress + logs stream to Firestore `pipeline_runs/`
- If CF nears the 60-min wall-clock limit, it saves a checkpoint to GCS and enqueues a continuation item (`HandoffTriggered`)
- Draft saved to GCS `drafts/{race_id}.json`; admin publishes via `races-api`
- Frontend polls `races-api /runs/{run_id}` + `/runs/{run_id}/logs?since=N` every 2–3 seconds

**Setup** (Terraform):
```bash
cd infra
# enable_agent_function is true by default in variables.tf
terraform apply
```

Environment variables set automatically by Terraform:
- `STORAGE_MODE=gcp`
- `GCS_BUCKET_NAME=smartervote-sv-data-{env}`
- `FIRESTORE_PROJECT=smartervote`
- API keys via Secret Manager

## Optional: Pipeline Client Cloud Mode

The `pipeline_client` server can also be deployed to Cloud Run for cases where you want a long-running server instead of a CF. Disabled by default (`enable_pipeline_client = false`).

**How it works** (when enabled):
- Pipeline runs on Cloud Run (Auth0-protected, port 8001)
- Agent output saves to GCS `drafts/` prefix first
- Admin publishes draft → GCS `races/` prefix
- Races API reads from GCS with 300s TTL cache
- Run history, race records, and queue persist to Firestore

```bash
cd infra
# Edit terraform.tfvars: enable_pipeline_client = true
terraform apply
```

## Mode Detection

The pipeline auto-detects storage mode based on environment:

| Variable | Indicates |
|----------|-----------|
| `GOOGLE_CLOUD_PROJECT` | Cloud mode |
| `K_SERVICE` | Cloud Run |
| None of above | Local mode |

## Storage Abstraction

Both modes use the same code via storage backends:

```python
# Local mode
storage = LocalStorageBackend(base_path="data/published")

# Cloud mode
storage = GCPStorageBackend(bucket_name="sv-data")
```

Switch by setting `STORAGE_BACKEND=gcp` environment variable.

## Search Caching

Web search results are cached in SQLite to avoid redundant Serper API calls:
- **TTL**: 7 days (configurable via `SEARCH_CACHE_TTL_HOURS`)
- **Location**: `data/cache/search_cache.db`
- **Scope**: Works in both local and cloud modes

## Output

All modes produce identical RaceJSON v0.3 files:
- `{race-id}.json` with candidates, issues, sources
- 12 canonical issues per candidate
- Confidence levels (high/medium/low) per issue stance
- Optional multi-LLM review (Claude, Gemini, Grok) with ValidationGrade (A–F)
- Source attribution with freshness tracking
