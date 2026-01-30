# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-29T09:54:42+08:00
**Commit:** 4222912
**Branch:** main

## OVERVIEW
Go backend (Gin/GORM/Postgres) + React/Vite/Tauri frontend, deployed via Helm with local dev Makefile helpers.

## STRUCTURE
```
./
├── server/              # Go backend (cmd/internal/tests/config)
├── frontend/            # React tooling (vite/tsconfig)
├── apps/                # Web + desktop apps
├── packages/            # Shared packages
├── deploy/              # Helm charts + Dockerfiles
├── ddl/sql/             # DB schema init
└── scripts/             # local setup helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Backend entry | server/cmd/zeus/main.go | starts HTTP server |
| Service wiring | server/internal/app/bootstrap.go | repo + service init |
| API routes | server/internal/api/handler/router.go | Gin routes |
| DB schema | ddl/sql/init.sql | base schema + indexes |
| Helm deploy | deploy/helm | charts + values |
| Frontend app | apps/web/src | React UI |
| Tauri shell | apps/desktop/src/main.rs | Windows flag DO NOT REMOVE |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| main | func | server/cmd/zeus/main.go | boot server |
| BuildRouter | func | server/internal/app/bootstrap.go | DI + router |
| RegisterRoutes | func | server/internal/api/handler/router.go | API wiring |

## CONVENTIONS
- Clean architecture: api → service → domain → repository/infra.
- Repository interfaces in server/internal/repository, Postgres impl in server/internal/repository/postgres.
- Helm values files: deploy/helm/values.*.yaml (deps/full/dev).

## ANTI-PATTERNS (THIS PROJECT)
- Do not access GORM directly from service layer.
- Avoid direct git CLI calls; use infra/gitclient.

## COMMANDS
```bash
make run-backend
make run-frontend
make build-postgres-image
make build-backend-image
make build-frontend-image
NAMESPACE=test make start-all
NAMESPACE=test make start-deps-dev
make test-integration
```

## NOTES
- Repo contains large build artifacts under apps/desktop/target and fixtures under resources/; ignore for code navigation.
