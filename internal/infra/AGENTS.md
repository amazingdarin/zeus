# INTERNAL/INFRA

External IO adapters and low-level clients.

## STRUCTURE
```
internal/infra/
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
| LLM client | internal/infra/llm | chat + streaming |
| Embedding | internal/infra/embedding | resolver interface |
| Model runtime | internal/infra/modelruntime | list/test APIs |
| Git ops | internal/infra/gitclient | clone/pull/commit/push |
| Object storage | internal/infra/objectstorage | S3 asset ops |

## CONVENTIONS
- No business logic; only IO + protocol adapters.
