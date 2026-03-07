# Local Development Environment & Automation

> Generated on: 2026-01-18

## 1. Zeus Application

| Component | Detail |
|-----------|--------|
| **Version** | `0.1.0` (from `apps/web/package.json`) |
| **Backend Port** | `:8080` |
| **Frontend Port** | `:5173` (Vite) |
| **Project Root** | `/Users/darin/mine/code/zeus` |
| **Backend Build** | `make run-backend` |
| **Frontend Dev** | `make run-frontend` (npm run tauri dev) |

## 2. Middleware Stack

| Service | Connection Info | Status |
|---------|-----------------|--------|
| **PostgreSQL** | `localhost:5432` (db: `zeus`, user: `zeus`, via `kubectl port-forward`) | Backed by k3s service `postgres/postgres` |
| **Object Storage** | `http://localhost:9000` (S3 API) | Configured |
| **Git Remote** | `git@github.com:code-yeongyu/zeus.git` (implied) | Branch: `main` |

## 3. Automation Skills

The project includes an automation script `scripts/dev-skill.sh` that provides the following skills:

### 🤖 Skill 1: SQL Auto-Migrate
- **Trigger**: Changes to `ddl/sql/*.sql`
- **Action**: Connects to Postgres and executes the modified SQL file.
- **Usage**: `scripts/dev-skill.sh watch-sql`

### 🚀 Skill 2: Code Auto-Deploy
- **Trigger**: Changes to `server/cmd/`, `server/internal/` (Backend) or `apps/web/` (Frontend)
- **Backend Action**: Kills existing process, recompiles via `make run-backend`.
- **Frontend Action**: Vite handles HMR automatically. If config changes, restart via `make run-frontend`.
- **Usage**: `scripts/dev-skill.sh watch-code`

## 4. Quick Start

Start the PostgreSQL port-forward before running local services:

```bash
KUBECONFIG=/Users/darin/mine/code/homeserver/secrets/kubeconfig_gz_cluster.yaml kubectl -n postgres port-forward svc/postgres 5432:5432
```

Local dev now uses the k3s PostgreSQL instance in namespace `postgres`.

- `server/config.yaml` points to `localhost:5432`, and a local-only `server/config.local.yaml` is auto-merged if present.
- `make run-app-backend` loads `apps/app-backend/.env` and then overrides it with `apps/app-backend/.env.local`.
- `apps/app-backend/.env.local` must point to the same PostgreSQL instance as `server/config.local.yaml`; otherwise `/api/projects` can succeed while project-scoped app-backend routes return `PROJECT_NOT_FOUND`.
- The cluster PostgreSQL password is stored outside this repo in `/Users/darin/mine/code/homeserver/secrets/postgresql_access.txt`.

Run all automation in background:
```bash
./scripts/dev-skill.sh start
```

## 5. Langfuse Observability (Optional)

Langfuse provides LLM observability for RAG operations including traces, metrics, and evaluations.

### Option A: Self-Hosted via Helm

1. Enable Langfuse in the Helm deployment:

```bash
# In values.deps-dev.yaml, set:
langfuse:
  enabled: true

# Local k3s storage class (recommended)
postgres:
  persistence:
    storageClassName: local-path

# Then deploy
NAMESPACE=dev make start-deps-dev
```

> Langfuse chart now includes a DB bootstrap Job that idempotently creates/updates the `langfuse` DB user and database on install/upgrade.

2. Access Langfuse UI at `http://localhost:30300`

3. Create a project and get API keys from Settings > API Keys

4. Set environment variables for app-backend:

```bash
export LANGFUSE_ENABLED=true
export LANGFUSE_PUBLIC_KEY=pk-xxx
export LANGFUSE_SECRET_KEY=sk-xxx
export LANGFUSE_HOST=http://localhost:30300
```

### Option B: Langfuse Cloud

1. Sign up at https://cloud.langfuse.com
2. Create a project and get API keys
3. Set environment variables:

```bash
export LANGFUSE_ENABLED=true
export LANGFUSE_PUBLIC_KEY=pk-xxx
export LANGFUSE_SECRET_KEY=sk-xxx
# LANGFUSE_HOST defaults to https://cloud.langfuse.com
```

### App-Backend Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LANGFUSE_ENABLED` | Enable/disable observability | `true` if keys provided |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key | Required |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key | Required |
| `LANGFUSE_HOST` | Langfuse server URL | `https://cloud.langfuse.com` |

### What Gets Traced

- RAG query classification
- Retrieval operations (basic, HyDE, multi, RAPTOR)
- Reranking operations
- Hierarchy context loading
- LLM generations
- Evaluation scores (precision, recall, faithfulness, relevancy)
