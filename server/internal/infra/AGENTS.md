# INTERNAL/INFRA

External IO adapters and low-level clients.

## STRUCTURE
```
server/internal/infra/
├── llm/            # OpenAI-compatible LLM client
├── embedding/      # embedder + runtime resolver interface
├── modelruntime/   # model list/test client
├── gitclient/      # git operations
├── objectstorage/  # S3 assets
└── session/        # session manager
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| LLM client | server/internal/infra/llm | chat + streaming |
| Embedding | server/internal/infra/embedding | resolver interface |
| Model runtime | server/internal/infra/modelruntime | list/test APIs |
| Git ops | server/internal/infra/gitclient | clone/pull/commit/push |
| Object storage | server/internal/infra/objectstorage | S3 asset ops |

## CONVENTIONS
- No business logic; only IO + protocol adapters.
