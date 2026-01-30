# INTERNAL/API

Gin HTTP layer: handlers, middleware, and DTOs.

## STRUCTURE
```
server/internal/api/
├── handler/     # route handlers + router
├── middleware/  # session/cors
└── types/       # request/response DTOs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Route registration | server/internal/api/handler/router.go | `/api` routes |
| Handler impls | server/internal/api/handler | one file per module |
| DTOs | server/internal/api/types | JSON shapes |
| Error schema | server/internal/api/types/error.go | `{code,message}` |

## CONVENTIONS
- Handlers validate input then call service.
- Errors returned as JSON `{code,message}`.
