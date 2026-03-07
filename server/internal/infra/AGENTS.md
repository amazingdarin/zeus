# INTERNAL/INFRA

External IO adapters and low-level clients.

## STRUCTURE
```
server/internal/infra/
├── embedding/      # embedder + runtime resolver interface
├── modelruntime/   # model list/test client
├── gitclient/      # git operations
├── gitadmin/       # bare-repo admin
└── session/        # session manager
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Embedding | server/internal/infra/embedding | resolver interface |
| Model runtime | server/internal/infra/modelruntime | list/test APIs |
| Git ops | server/internal/infra/gitclient | clone/pull/commit/push |
| Git admin | server/internal/infra/gitadmin | create/manage bare repos |

## CONVENTIONS
- No business logic; only IO + protocol adapters.
