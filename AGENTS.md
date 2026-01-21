# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-17T08:45:42Z  
**Commit:** 758a41a  
**Branch:** main

## OVERVIEW
Go backend (Gin/GORM/Postgres) + React/Vite/Tauri frontend in a monorepo. Doc-editor packages live under frontend workspaces.

## STRUCTURE
```
./
├── cmd/                # Go entrypoint
├── internal/           # backend clean architecture layers
├── frontend/           # React + Tauri app + packages
├── ddl/sql/            # DB schema init
├── docs/               # project docs
├── deploy/             # helm charts
├── tests/              # misc tests
└── resources/          # runtime data fixtures
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Backend entrypoint | cmd/zeus/main.go | wires repos/services/handlers |
| API routes | internal/api/handler/router.go | `/api` routes |
| DTOs | internal/api/types | request/response shapes |
| Use-cases | internal/service/* | service implementations in subdirs |
| Domain models | internal/domain | pure structs |
| DB repos | internal/repository/postgres | GORM + mappers |
| External IO | internal/infra | git/s3/llm/embedding/etc |
| DB schema | ddl/sql/init.sql | table definitions |
| Frontend entry | frontend/zeus/src/main.tsx | React bootstrap |
| Tauri entry | frontend/src-tauri/src/main.rs | desktop bootstrap |
| Doc editor libs | frontend/packages/doc-editor | Tiptap + OpenAPI nodes |

## CONVENTIONS (project-specific)
- Clean architecture: `api → service → domain → repository/infra` only.
- Handlers must be thin; service does business logic.
- Repository interfaces in `internal/repository`, GORM impls in `internal/repository/postgres`.
- API errors: JSON `{code,message}` (see `internal/api/types`).
- UI framework: **Ant Design** (per PROJECT_GUIDE.md).
- OpenAPI 3.1 is the API contract source; codegen is expected.

## ANTI-PATTERNS (THIS PROJECT)
- DO NOT generate Specs / ModuleSnapshot / RAG-derived facts (PROJECT_GUIDE redlines).
- DO NOT store document truth in DB; Git repo is the source of truth.
- DO NOT run git commands directly in service (must go through infra).

## COMMANDS
```bash
make run-backend
make run-frontend
make install
make dev-install
```

## NOTES
- No CI workflows detected under .github/workflows.
- Tauri Windows flag in `frontend/src-tauri/src/main.rs` is marked DO NOT REMOVE.
