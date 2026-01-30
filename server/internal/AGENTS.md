# INTERNAL OVERVIEW

Core backend implementation organized by clean architecture layers.

## STRUCTURE
```
server/internal/
├── api/         # HTTP handlers, DTOs, middleware
├── config/      # configuration structs + loader
├── domain/      # pure domain models
├── infra/       # external IO adapters (git/s3/llm/embedding/etc)
├── repository/  # data access interfaces + postgres impls
├── service/     # business use-cases
├── util/        # shared helpers
└── types/       # shared type keys
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Request handlers | server/internal/api/handler | Gin handlers + router |
| DTOs | server/internal/api/types | request/response shapes |
| Service interfaces | server/internal/service/*.go | module interfaces |
| Service implementations | server/internal/service/* | subdir per domain |
| DB repositories | server/internal/repository/postgres | GORM + mappers |
| Git-backed repos | server/internal/repository/git | knowledge plane |
| External adapters | server/internal/infra | S3/Git/LLM/etc |

## CONVENTIONS
- Keep handlers thin; push logic into services.
- Repositories expose interfaces in `server/internal/repository` and impls in `server/internal/repository/postgres`.
- Domain models are pure structs without IO.

## ANTI-PATTERNS
- service should not access GORM directly.
- avoid direct git CLI; use infra/gitclient.
