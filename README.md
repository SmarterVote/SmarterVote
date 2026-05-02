# SmarterVote

AI-powered candidate research for U.S. elections.

SmarterVote uses a multi-phase AI agent to research election races and produce structured candidate profiles covering 12 policy issues — with sources, confidence levels, and optional multi-LLM review.

## Requirements

- Python 3.10+
- Node.js 22+
- `OPENAI_API_KEY` and `SERPER_API_KEY` (see `.env.example`)

## Getting Started (Local Dev)

```powershell
# Install dependencies and configure environment
pip install -r requirements.txt
pip install -e shared/
cp .env.example .env   # add your API keys

# Start all services (pipeline backend :8001, races API :8080, web :5173)
.\dev-start.ps1
```

The pipeline dashboard is available at `http://localhost:5173/admin/pipeline`.

See [Local Development](docs/local-development.md) for detailed setup instructions.

## Architecture

- **Local dev**: Admin triggers runs via `pipeline_client` FastAPI server (`:8001`) → agent runs in-process → drafts saved locally → races API serves from `data/published/`
- **Production (GCP)**: Admin queues a race via `races-api` → Firestore `pipeline_queue` → Eventarc → gen2 Cloud Function → `AgentHandler` → GCS draft → admin publishes → races API serves from GCS

See [Architecture](docs/architecture.md) for full details.

## Docs

- [Architecture](docs/architecture.md)
- [Local Development](docs/local-development.md)
- [Deployment](docs/deployment-guide.md)
- [Pipeline Modes](PIPELINE_MODES.md)

## License

CC BY-NC-SA 4.0 (see LICENSE)
