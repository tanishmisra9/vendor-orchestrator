# Vendor Orchestrator

**Agentic Vendor Master Assistant**

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Python](https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) [![CI](https://github.com/tanishmisra9/vendor-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/tanishmisra9/vendor-orchestrator/actions/workflows/ci.yml)

A modular AI solution for managing, cleaning, deduplicating, and enriching vendor data across an enterprise. The application now ships as a custom `FastAPI + React + Vite` web app with an Apple-inspired dark analyst experience, while preserving the existing LangGraph orchestration and Python domain logic.

> **Note:** This app was previously deployed on Railway and the live demo was taken down in November 2026. Run it locally using the instructions below.

## Architecture

The system distributes work across four autonomous agents coordinated via a shared MCP (Model Context Protocol) context layer:

- **DataQualityAgent** — Standardizes vendor names, addresses, and tax IDs; flags records with quality issues
- **DeduplicationAgent** — Clusters duplicates using blocking strategies, RapidFuzz fuzzy matching, and LLM-based reasoning for ambiguous cases
- **LoaderAgent** — Bulk-loads deduplicated records into the MySQL vendor master with canonical/duplicate status
- **VendorCheckAgent** — Real-time duplicate check when analysts add new vendors manually

### Key features

- **Premium analyst shell** with a glassmorphism dashboard, route-based navigation, live metrics, and audit visibility
- **Batch pipeline** with upload validation, staged live progress, result metrics, and quality reporting
- **Blocking-based deduplication** for scalable matching (tested at 100k records) — exact tax ID matching, multi-strategy blocking (sorted tokens, first token, tax ID), and a name-similarity override for near-identical vendor names
- **LLM fail-fast** — gracefully degrades if OpenAI quota is exhausted (2 consecutive failures skips remaining LLM calls)
- **LLM prompt injection protection** — vendor field sanitization (truncation, control char stripping) and system-message guardrails
- **Add vendor review flow** with duplicate analysis, override logging, and server-side validation
- **Search vendor master** with aggregate metrics, filter controls, and duplicate-cluster inspection
- **Audit log** tracking all agent actions and analyst override decisions, with configurable strict mode
- **Password authentication** via API session cookie (optional, via environment variable)
- **Alembic database migrations** for safe schema evolution
- **Upload size limit** (200 MB default) to prevent OOM on large files
- **Sanitized error messages** — API keys, credentials, and connection strings are stripped from UI error displays
- **Resilient entrypoint** — retries database migrations up to 10 times on startup, handling cold-start race conditions on cloud platforms

## Deployment

The app was previously deployed on [Railway](https://railway.app) (now taken down) with two services:

- **VendorOrchestrator** — Dockerized FastAPI app serving the compiled React frontend and API from one container
- **MySQL** — Railway-managed MySQL 8.0 instance

Railway auto-deployed on every push. The entrypoint script waits for the database to be ready, runs Alembic migrations, then starts `uvicorn` on the Railway-assigned `PORT`.

### Deploy your own (the steps used for the original deployment)

1. Push this repo to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Add a **MySQL** database service
4. Add a new service from your GitHub repo
5. Set environment variables on the app service (copy `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` from the MySQL service into `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`)
6. Add your `OPENAI_API_KEY`
7. Under **Settings > Networking**, generate a domain and set the port to match Railway's `PORT` (typically `8080`)

## Quick start (local)

### Prerequisites

- Docker & Docker Compose
- OpenAI API key

### Run with Docker

```bash
cp .env.example .env
# Edit .env with your OpenAI API key

docker compose up --build
```

The web app will be available at `http://localhost:8000`.

On startup, the entrypoint script retries Alembic migrations until the database is ready, then starts the API and serves the compiled frontend.

### Run locally (development)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm --prefix frontend install

cp .env.example .env
# Edit .env — ensure MySQL is running locally with matching credentials

# Apply database migrations
alembic upgrade head

# Terminal 1: API
uvicorn webapp.main:app --reload --port 8000

# Terminal 2: frontend (optional for hot reload)
npm --prefix frontend run dev
```

For pure production-style local testing, build the frontend and let FastAPI serve it:

```bash
npm --prefix frontend run build
uvicorn webapp.main:app --port 8000
```

## Database migrations

Schema changes are managed with [Alembic](https://alembic.sqlalchemy.org/). When you modify `db/models.py`:

```bash
# Auto-generate a migration
alembic revision --autogenerate -m "describe your change"

# Apply migrations
alembic upgrade head

# Rollback one step
alembic downgrade -1
```

In Docker and Railway, migrations run automatically on container startup via `entrypoint.sh`.

## Project structure

```
agents/          Agent modules (DataQuality, Deduplication, Loader, VendorCheck)
alembic/         Database migration scripts (Alembic)
context/         MCP shared context layer (in-memory state per pipeline run)
db/              SQLAlchemy models and connection factory with retry logic
frontend/        React + Vite + TypeScript analyst frontend
orchestrator/    LangGraph StateGraph workflow with stepwise execution
webapp/          FastAPI application, auth, batch jobs, and API schemas
utils/           Fuzzy matching, audit logging, error sanitization, LIKE escaping
tests/           Unit tests for agents, matching, loader, and hardening
data/            Sample vendor CSVs (100k well-formed, 50k malformed for testing)
entrypoint.sh    Startup script with database readiness retry loop
```

## Usage

1. **Overview** — Land on a premium analyst dashboard with high-level metrics, recent activity, and shortcuts into each workflow.
2. **Batch pipeline** — Upload a CSV/XLSX vendor file (max 200 MB), validate its columns, and follow DataQuality → Deduplication → Loader with live status updates.
3. **Add vendor** — Enter a single vendor record, run duplicate analysis, and explicitly choose whether to add or override.
4. **Vendor master** — Search and filter the vendor directory, view metrics, and inspect duplicate clusters.
5. **Audit trail** — Review all agent actions and analyst override decisions.

## Authentication

Set `REQUIRE_AUTH=true` and `APP_PASSWORD=your-secret` in `.env` to enable a password gate. For production, deploy behind an OAuth2 proxy (e.g., OAuth2-proxy, Cloudflare Access).

## Sample data

Two sample files are included in `data/` for testing:

- `sample_vendors_100k.csv` — 100,000 records with realistic duplicates, name variations, and data quality issues
- `sample_vendors_malformed_50k.csv` — 50,000 records with missing required columns, extra columns, and internal data issues (for testing column validation)

## Testing

```bash
pytest tests/ -v
npm --prefix frontend test
```

Python tests cover agents, matching logic, loader behavior, API routes, error sanitization, LIKE escaping, deterministic canonical selection, and prompt injection sanitization. Frontend tests cover authentication, batch upload flow, add-vendor duplicate feedback, vendor search cluster inspection, and audit mode switching.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for LLM deduplication | (required) |
| `MYSQL_HOST` | MySQL hostname | `localhost` |
| `MYSQL_PORT` | MySQL port | `3306` |
| `MYSQL_USER` | MySQL user | `vendor_admin` |
| `MYSQL_PASSWORD` | MySQL password | `changeme` |
| `MYSQL_DATABASE` | MySQL database name | `vendor_master_db` |
| `REQUIRE_AUTH` | Enable password authentication gate | `false` |
| `APP_PASSWORD` | Password for authentication gate | (empty) |
| `STRICT_AUDIT` | Fail pipeline on audit write errors | `true` |

## Tech stack

- **Python 3.11** — runtime
- **FastAPI** — API shell and production web server surface
- **React + Vite + TypeScript** — analyst frontend
- **LangGraph** — agent orchestration
- **OpenAI GPT-4** — LLM for ambiguous deduplication and vendor checks
- **Framer Motion** — motion system for page transitions and progress states
- **MySQL 8.0** — vendor master database
- **SQLAlchemy** — ORM
- **Alembic** — database migrations
- **RapidFuzz** — fuzzy string matching
- **Docker** — containerization
- **Railway** — cloud deployment (previously used; deployment taken down)
