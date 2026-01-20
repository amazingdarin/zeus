# Local Development Environment & Automation

> Generated on: 2026-01-18

## 1. Zeus Application

| Component | Detail |
|-----------|--------|
| **Version** | `0.1.0` (from `frontend/package.json`) |
| **Backend Port** | `:8080` |
| **Frontend Port** | `:5173` (Vite) |
| **Project Root** | `/Users/darin/mine/code/zeus` |
| **Backend Build** | `make run-backend` |
| **Frontend Dev** | `make run-frontend` (npm run tauri dev) |

## 2. Middleware Stack

| Service | Connection Info | Status |
|---------|-----------------|--------|
| **PostgreSQL** | `localhost:5432` (db: `zeus`, user: `zeus`) | Running (Docker) |
| **Object Storage** | `http://localhost:9000` (S3 API) | Configured |
| **Git Remote** | `git@github.com:code-yeongyu/zeus.git` (implied) | Branch: `main` |

## 3. Automation Skills

The project includes an automation script `scripts/dev-skill.sh` that provides the following skills:

### 🤖 Skill 1: SQL Auto-Migrate
- **Trigger**: Changes to `ddl/sql/*.sql`
- **Action**: Connects to Postgres and executes the modified SQL file.
- **Usage**: `scripts/dev-skill.sh watch-sql`

### 🚀 Skill 2: Code Auto-Deploy
- **Trigger**: Changes to `cmd/`, `internal/` (Backend) or `frontend/` (Frontend)
- **Backend Action**: Kills existing process, recompiles via `make run-backend`.
- **Frontend Action**: Vite handles HMR automatically. If config changes, restart via `make run-frontend`.
- **Usage**: `scripts/dev-skill.sh watch-code`

## 4. Quick Start

Run all automation in background:
```bash
./scripts/dev-skill.sh start
```
