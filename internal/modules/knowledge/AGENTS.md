# KNOWLEDGE MODULE

Document-level indexing services (fulltext + embedding) with document hooks.

## STRUCTURE
```
internal/modules/knowledge/service/
├── fulltext/    # fulltext index + hooks
├── embedding/   # embedding index + chunking + hooks
├── index.go     # shared index interfaces
└── search.go    # shared search interfaces
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Fulltext index | service/fulltext/service.go | Postgres tsvector queries |
| Embedding index | service/embedding/service.go | block-based chunking + pgvector |
| Chunking rules | service/embedding/chunker.go | block-first, 800/100 split |
| Document hooks | service/*/hooks.go | AfterSave/Delete/Move (async) |

## CONVENTIONS
- Index name uses projectKey by default.
- Hooks are async and must not block document writes.
- Embedding chunks preserve block_id when available.

## ANTI-PATTERNS
- Do not call GORM directly; use repository layer.
- Avoid synchronous hooks (document service must remain primary).
