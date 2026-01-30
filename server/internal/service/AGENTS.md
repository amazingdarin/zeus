# INTERNAL/SERVICE

Business use-cases; each domain has a subdirectory and a thin interface file in `server/internal/service/*.go`.

## STRUCTURE
```
server/internal/service/
├── <module>/        # implementation
├── <module>.go      # interface for module
└── model_config.go  # shared model runtime DTOs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Project lifecycle | server/internal/service/project | repo init + DB wiring |
| Knowledge docs | server/internal/service/knowledge | Git-backed CRUD + proposals |
| RAG + summaries | server/internal/service/rag | embedding + summaries |
| Chat streaming | server/internal/service/chatstream | SSE streaming pipeline |
| Model runtime | server/internal/service/model | runtime CRUD + resolver |
| Tasks | server/internal/service/task | async task queue |

## CONVENTIONS
- Implementations named `Service` or `RuntimeService` with interface assertion in module file.
- Inject repositories and infra dependencies via constructors.
