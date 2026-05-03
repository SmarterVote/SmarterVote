# Local Development

This guide runs the web app, the production-shaped `races-api`, and the local-only pipeline development API.

## Prerequisites

- Python 3.10+
- Node.js 22+
- Git
- `OPENAI_API_KEY` and `SERPER_API_KEY` for real agent runs

Optional review keys:

- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

## Environment Setup

From the project root, the directory that contains `pyproject.toml`:

```powershell
copy .env.example .env
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e shared/

cd web
npm install
cd ..
```

Edit `.env` and set at minimum:

```env
OPENAI_API_KEY=sk-proj-your-key-here
SERPER_API_KEY=your-serper-key-here
```

## One-command Start

```powershell
.\dev-start.ps1
```

Expected services:

| Service | Port | Notes |
|---------|------|-------|
| Web | 5173 | SvelteKit app |
| Races API | 8080 | Production-shaped API used by the frontend |
| Pipeline dev API | 8001 | Local-only in-process agent runner |

## Manual Start

Terminal 1, pipeline dev API:

```powershell
.venv\Scripts\Activate.ps1
python -m uvicorn pipeline_client.backend.main:app --host 0.0.0.0 --port 8001 --reload
```

Terminal 2, races API:

```powershell
.venv\Scripts\Activate.ps1
python -m uvicorn main:app --app-dir services/races-api --host 0.0.0.0 --port 8080 --reload
```

The `services/races-api` directory is not currently an importable Python package because of the hyphen in its name, so use `--app-dir` for local uvicorn runs.

Terminal 3, web:

```powershell
cd web
npx vite dev --port 5173 --host
```

## Using the App

- Homepage: `http://localhost:5173`
- Admin dashboard: `http://localhost:5173/admin/pipeline`
- Races API health: `http://localhost:8080/health`
- Pipeline dev API health: `http://localhost:8001/health`

The admin UI should target `races-api` for production-shaped admin behavior. The pipeline dev API is retained for local direct runs and debugging while the Cloud Function migration is completed.

## Race IDs

Race IDs should match:

```text
{state}-{office}-{year}
```

Examples:

- `az-senate-2026`
- `ga-governor-2026`
- `ny-04-house-2026`

## Checks

```powershell
pytest -q

cd web
npm run check
npm run test:unit
```

## Troubleshooting

### `OPENAI_API_KEY is not set`

Make sure `.env` exists in the project root and that the server was started from the project root or with the documented `--app-dir` command.

### OpenAI `429 insufficient_quota`

The key is valid but the account lacks credits or quota. Add billing credits in the OpenAI dashboard.

### Port Conflicts

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Import Errors

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e shared/
```

### Force Fresh Search Results

```powershell
Remove-Item -Recurse -Force data\cache
```

## Production Notes

In production, the admin dashboard queues races through `services/races-api`. A Firestore `pipeline_queue` document triggers the Cloud Function in `functions/agent`, which calls `AgentHandler` and writes draft output to GCS. The local pipeline API does not run in production.
