# INTERNAL/REPOSITORY

Repository interfaces and storage-specific implementations.

## STRUCTURE
```
internal/repository/
├── *.go                 # repository interfaces
├── postgres/            # GORM repositories
│   ├── model/           # GORM models
│   └── mapper/          # domain <-> model mappers
├── git/                 # Git-backed knowledge repo
├── ragindex/            # vector index storage
└── ragsummary/          # document summary storage
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Interfaces | internal/repository/*.go | domain-facing contracts |
| Postgres impl | internal/repository/postgres | GORM + CRUD |
| Mappers | internal/repository/postgres/mapper | JSON encode/decode helpers |
| Git knowledge | internal/repository/git | file-based knowledge source |

## CONVENTIONS
- Interface in root, implementation in `postgres/`.
- Mappers handle JSONB encode/decode via `mapper/json.go`.
