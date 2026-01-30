# Codebase Structure

This document describes the current modular structure and shared foundations.

## Top-Level Layout
```
./
├── server/
│   ├── cmd/                  # Entrypoints
│   │   └── zeus/             # Backend main
│   ├── internal/
│   │   ├── app/              # Application bootstrap (wiring)
│   │   ├── core/             # Shared capabilities (log/middleware/util)
│   │   ├── modules/          # Business modules (bounded contexts)
│   │   ├── api/              # Router + API wiring
│   │   ├── infra/            # External IO adapters
│   │   ├── repository/       # Data access (shared + non-module repos)
│   │   └── service/          # Cross-cutting services (non-module)
├── frontend/                 # React + Tauri tooling
├── apps/                     # Web/Tauri apps
└── docs/                     # Docs
```

## server/internal/app
Centralized bootstrap and wiring:

- `bootstrap.go`
  - InitConfig / InitLogger / InitDB / InitS3 / InitGit*
  - Build services and register routes
  - Exposes `BuildRouter(ctx)` and `Getenv(...)`

## server/internal/core
Shared utilities (no business logic):

- `core/log/` — log formatter + session hook
- `core/middleware/` — CORS / session / request logging
- `core/util/` — shared utilities (crypto, slug, envelope, etc.)

> Rule: core must not depend on modules.

## server/internal/modules
Each module is a bounded context with its own API, service, and repository layers.

```
server/internal/modules/
├── project/
│   ├── api/                  # Project handlers
│   ├── service/              # ProjectService implementation
│   └── repository/           # Project repository + postgres impl
├── document/
│   ├── api/                  # Document handlers
│   └── service/              # Docstore + index manager
└── knowledge/
    ├── api/                  # Knowledge handlers + change proposals
    ├── service/              # KnowledgeService implementation
    └── search/
        ├── api/              # Search handler
        └── service/          # Search service
```

### Module Interaction
- Modules depend on other modules **only through service interfaces**.
- Repositories are never accessed跨模块.
- App layer (bootstrap) wires implementations to interfaces.

## server/internal/infra
External adapters and low-level IO:

- `infra/gitclient`, `infra/gitadmin`
- `infra/modelruntime`, `infra/embedding`, `infra/llm`
- `infra/localstorage`, `infra/assetmeta`, `infra/assetcontent`
- `infra/session`, `infra/taskcallback`

## server/internal/api
Router aggregation + non-module handlers:

- `handler/router.go` registers modules and shared handlers

## server/internal/repository
Shared repositories and storage implementations:

- `repository/repository.go` — aggregated Repo struct
- `repository/postgres/` — common postgres repos
- `repository/git/` — git adapters (document reader)

## server/internal/service
Cross-cutting services that are not module-specific:

- `service/asset`, `service/storage_object`
- `service/provider`, `service/model`
- `service/rag`, `service/openapi`
- `service/convert`, `service/task`

---

## Conventions
- Modules own their APIs and repositories.
- App bootstrap is the only place that wires concrete dependencies.
- Core should remain minimal and dependency-free.
