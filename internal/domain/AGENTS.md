# INTERNAL/DOMAIN

Pure domain models and enums. No IO or infra dependencies.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core entities | internal/domain/*.go | project/document/task/rag |
| RAG types | internal/domain/rag | query + result structs |

## CONVENTIONS
- Keep structs minimal and serializable.
- Avoid infra/service imports.
