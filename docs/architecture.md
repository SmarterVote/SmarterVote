# SmarterVote Architecture

**Multi-Phase AI Agent for Electoral Analysis**

## Overview

SmarterVote uses an AI research agent to produce structured candidate profiles for U.S. election races. The agent uses OpenAI function calling with Serper web search to gather information across seven pipeline steps, producing RaceJSON v0.3 output with policy stances, source URLs, and confidence levels.

## Agent Phases

```
DISCOVERY → IMAGES → ISSUES (×12 per-candidate) → FINANCE → REFINEMENT → REVIEW (optional) → ITERATION
```

### Step 1: Discovery (15% weight)
- Identify the race (office, jurisdiction, election date)
- Find all candidates (name, party, incumbent status)
- Locate campaign websites, social media, career history
- Write brief nonpartisan summaries
- Gather polling data if available

### Step 2: Image Resolution (5% weight)
- Verify/find direct image URLs per candidate
- Sources: Wikipedia, house.gov, Ballotpedia, official campaign sites

### Step 3: Issue Research (35% weight)
- 12 per-candidate sub-agent calls (one per canonical issue)
- Each call searches the web for a candidate's position on a single issue
- Returns stance, confidence level, and source URLs per candidate per issue

### Step 4: Finance & Voting (10% weight)
- Dedicated donor and voting-record research per candidate
- FEC filings, campaign finance databases, legislative voting records

### Step 5: Refinement (15% weight)
- Tools-mode per-candidate and meta cleanup
- Verify and fix factual inconsistencies via additional web searches
- Fill in weak/missing stances
- Improve candidate summaries
- Ensure all 12 issues are covered for each candidate

### Step 6: AI Review (12% weight, optional)
- Send results to Claude, Gemini, and Grok for independent fact-checking
- Returns `AgentReview[]` with flags and verdict per reviewer
- Computes `ValidationGrade` (A–F) from combined scores

### Step 7: Review Iteration (8% weight)
- Tools-mode pass to address review flags
- Up to 2 cycles of corrections based on reviewer feedback

### Update/Rerun Mode
When a published profile already exists for a race, the agent enters update mode:
- Adds Phase 0: **Roster Sync** (sync candidate list) + **Meta Update** (refresh race metadata)
- Runs the same steps but reuses existing data as context
- Images phase runs after refinement instead of after discovery
- Each issue is re-researched with existing stances as context

## Components

```
functions/agent/                    # Cloud Function entry point (production)
├── main.py               # gen2 CF — Firestore Eventarc trigger → AgentHandler
└── requirements.txt      # CF runtime dependencies (includes pipeline_client)

pipeline_client/agent/              # AI research agent (used by CF and local dev)
├── agent.py              # Agent loop, multi-phase orchestration, search + fetch
├── prompts.py            # Phase-specific prompt templates
├── tools.py              # Tool definitions for agent tool-use loop
├── handlers.py           # LLM request/response handling, JSON extraction
├── review.py             # Multi-LLM review (Claude, Gemini, Grok) + ValidationGrade
├── images.py             # Candidate image URL resolution strategies
├── ballotpedia.py        # Ballotpedia lookup helper
├── search_cache.py       # SQLite cache for Serper results (7-day TTL)
├── cost.py               # Token counting + cost estimation per model
└── utils.py              # Logging, JSON extraction utilities

pipeline_client/          # Execution engine (shared by CF and local dev server)
├── backend/
│   ├── handlers/
│   │   └── agent.py      # AgentHandler — wraps run_agent() with progress + Firestore logging
│   ├── firestore_logger.py# Streams run logs + progress to Firestore (pipeline_runs/)
│   ├── main.py            # FastAPI local dev server (Auth0, WebSocket, :8001)
│   ├── models.py          # PipelineStep enum, RunOptions, RunInfo, RunStep
│   ├── pipeline_runner.py # Async step execution, logging, artifact saving
│   ├── step_registry.py   # Handler registry (step name → StepHandler)
│   ├── run_manager.py     # Run lifecycle (in-memory active, Firestore completed)
│   ├── queue_manager.py   # Persistent queue (Firestore cloud / JSON local)
│   ├── race_manager.py    # Unified race records + metadata + run history
│   ├── settings.py        # Pydantic Settings from env (storage mode, auth, etc.)
│   ├── logging_manager.py # WebSocket log broadcasting (local dev)
│   ├── storage.py         # Artifact + race JSON storage routing
│   ├── storage_backend.py # LocalStorageBackend / GCPStorageBackend
│   ├── alerts.py          # Monitoring and alerting (optional)
│   └── pipeline_metrics.py# Token usage + cost tracking (optional)
└── run.py                 # CLI entry point

services/
└── races-api/             # Public REST API + admin endpoints

shared/
└── models.py              # Pydantic v2 models (RaceJSON, Candidate, CanonicalIssue)

web/                       # SvelteKit frontend (static, deployed to GitHub Pages)
└── src/lib/types.ts       # TypeScript types (must sync with shared/models.py)
```

## AI Model Configuration

| Mode | Research Model | Sub-task Model | Use Case |
|------|---------------|----------------|----------|
| Cheap (default) | gpt-5.4-mini | gpt-5-nano | Fast, low-cost research |
| Standard | gpt-5.4 | gpt-5.4-mini | Higher quality research |

### Review Models

| Provider | Cheap Mode | Full Mode |
|----------|-----------|-----------|
| Claude | claude-haiku-4-5-20251001 | claude-sonnet-4-6 |
| Gemini | gemini-3.1-flash-lite-preview | gemini-3.1-pro-preview |
| Grok | grok-4-1-fast-non-reasoning | grok-4.20-0309-reasoning |

**Configuration**: `cheap_mode=true` (default) in RunOptions. Override specific models via `research_model`, `claude_model`, `gemini_model`, `grok_model`.

## Confidence Levels

| Level | Criteria |
|-------|----------|
| HIGH | Multiple corroborating sources or official campaign position |
| MEDIUM | Single credible source |
| LOW | Inferred or unverified |

## Search Caching

Web search results are cached in a SQLite database to avoid redundant Serper API calls:

- **Location**: `data/cache/search_cache.db` (configurable)
- **TTL**: 7 days (configurable via `SEARCH_CACHE_TTL_HOURS`)
- **Scope**: Cached per query string, optionally tagged by race_id
- **Benefit**: Re-runs and iterative development don't waste search API calls

## Data Flow

### Production (GCP)
```
Admin → races-api POST /queue/{race_id}
    ↓
Firestore pipeline_queue (document created)
    ↓
Eventarc trigger → Cloud Function (functions/agent/main.py)
    ↓
AgentHandler.handle() runs all pipeline steps
    ↓
(If CF nears 60-min limit: checkpoint → write continuation doc → HandoffTriggered)
    ↓
GCS drafts/{race_id}.json  (saved after last step)
    ↓
Admin → races-api POST /admin/races/{race_id}/publish → GCS races/{race_id}.json
    ↓
Races API serves published data; frontend polls /runs/{id} + /runs/{id}/logs
```

### Local Dev
```
Race ID (e.g., ga-senate-2026)
    ↓
Step 1: Discover candidates, career history, polls via web search
    ↓
Step 2: Resolve candidate headshot image URLs
    ↓
Step 3: Research 12 issues per candidate (12 × N sub-agent calls)
    ↓
Step 4: Research finance + voting records per candidate
    ↓
Step 5: Refine and clean full profile via tools-mode passes
    ↓
Step 6 (optional): Multi-LLM review (Claude + Gemini + Grok)
    ↓
Step 7: Address review flags (up to 2 iterations)
    ↓
Save draft RaceJSON → admin publishes → Races API serves it
```

## Storage

### Local Dev

| Location | Use |
|----------|-----|
| `data/published/` | Published race profiles (JSON) |
| `data/drafts/` | Agent output before publish |
| `data/cache/` | Search cache (SQLite, 7-day TTL) |
| `pipeline_client/artifacts/` | Per-run RunResponse snapshots |
| In-memory | Active runs + race records (lost on restart) |

### Cloud (GCP)

| Service | Use |
|---------|-----|
| GCS `races/` | Published race profiles |
| GCS `drafts/` | Agent output before publish |
| Firestore `pipeline_runs/` | Completed run records |
| Firestore `races/` | Race metadata + run history |
| Firestore `pipeline_queue` | Queue items |
| Secret Manager | API keys |

## Pipeline Client API Endpoints (local dev, Auth0-protected except `/health`)

The `pipeline_client` FastAPI server (`:8001`) is used for **local development only**. In production, the same agent logic runs inside the Cloud Function.

### Race Management (`/api/races/`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/races` | List all races with metadata |
| GET | `/api/races/{race_id}` | Get race metadata + status |
| POST | `/api/races/{race_id}/run` | Run agent for a race |
| POST | `/api/races/{race_id}/publish` | Promote draft → published |
| POST | `/api/races/{race_id}/unpublish` | Move published → draft |
| GET | `/api/races/{race_id}/runs` | List runs for a race |

### Pipeline Infrastructure

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/queue` | List queue items |
| POST | `/queue` | Add to queue |
| GET | `/runs` | List recent runs |
| GET | `/runs/{run_id}` | Get run details |
| GET | `/health` | Health check (unauthenticated) |

### Live Logs (local dev)

| Path | Purpose |
|------|---------|
| `/ws/logs` | WebSocket — live log streaming (all runs) |
| `/ws/logs/{run_id}` | WebSocket — live logs for a specific run |

## Races API Endpoints

### Admin Endpoints (X-Admin-Key required)

The `races-api` service hosts both public and admin endpoints. Admin endpoints manage the pipeline in production.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/queue/{race_id}` | Queue a race for the CF pipeline |
| GET | `/runs/{run_id}` | Get run status + metadata |
| GET | `/runs/{run_id}/logs` | Get run log entries (supports `?since=N`) |
| POST | `/admin/races/{race_id}/publish` | Publish a draft from GCS |
| POST | `/admin/races/{race_id}/unpublish` | Move published → draft |
| GET | `/admin/races` | List all races with pipeline status |

### Public Endpoints (no auth)

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/races` | List race IDs |
| GET | `/races/summaries` | Race summaries for search |
| GET | `/races/{race_id}` | Full race data |
| GET | `/health` | Health check |

## Infrastructure (Terraform)

Located in `infra/`.

- **Cloud Run**: `races-api` (public + admin); optional `pipeline-client` server (`enable_pipeline_client = false` by default)
- **Cloud Function** (gen2): Agent CF triggered by Firestore Eventarc (`enable_agent_function = true` by default)
- **GCS**: Data bucket (`races/`, `drafts/`, `checkpoints/`, `analytics/`)
- **Firestore**: `pipeline_queue` (CF trigger), `pipeline_runs/` (run logs + status), `races/` (metadata)
- **Secret Manager**: API keys (openai, serper, anthropic, gemini, xai, admin)
- **Artifact Registry**: Docker images (keeps 5 versions, deletes >30 days)
- **Eventarc**: Trigger on `pipeline_queue` Firestore document creation → CF

## Canonical Issues

1. Healthcare
2. Economy
3. Climate/Energy
4. Reproductive Rights
5. Immigration
6. Guns & Safety
7. Foreign Policy
8. Social Justice
9. Education
10. Tech & AI
11. Election Reform
12. Local Issues

Defined in `shared/models.py` as `CanonicalIssue` enum and `pipeline_client/agent/prompts.py`.
