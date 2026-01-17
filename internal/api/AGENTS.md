# INTERNAL/API

Gin HTTP layer: handlers, middleware, and DTOs.

## STRUCTURE
```
internal/api/
├── handler/     # route handlers + router
├── middleware/  # session/cors
└── types/       # request/response DTOs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Route registration | internal/api/handler/router.go | `/api` routes |
| Handler impls | internal/api/handler | one file per module |
| DTOs | internal/api/types | JSON shapes |
| Error schema | internal/api/types/error.go | `{code,message}` |

## CONVENTIONS
- Handlers validate input then call service.
- Errors returned as JSON `{code,message}`.
