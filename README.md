# Zeus

English | [简体中文](README.zh-CN.md)

Zeus is a layered document and AI collaboration system built around project documents, knowledge bases, retrieval-augmented generation, chat agents, plugin extensibility, and multi-platform delivery. The repository is organized as a monorepo where platform services, document and AI capabilities, the web frontend, and the desktop shell are implemented as separate layers.

## Core Capabilities

- Document tree, block editor, comments, trash, import/export, versioning, and sync-related workflows
- Knowledge indexing, full-text search, vector search, RAG, and RAPTOR tree generation
- Document-aware chat, skill execution, MCP integration, and plugin extensibility
- Teams, projects, members, invitations, authentication, and multi-tenant owner-scope management
- Web and Tauri desktop clients on top of the same product model

## Layered Architecture

| Layer | Directory | Stack | Responsibility |
| --- | --- | --- | --- |
| Platform backend | `server/` | Go + Gin + GORM + Postgres | Users, teams, projects, auth, tenant boundaries |
| Application backend | `apps/app-backend/` | TypeScript + Express + Postgres | Documents, knowledge indexing, RAG, chat agent, plugins, OCR, PPT |
| Frontend | `apps/web/` | React + Vite + Ant Design | Document UI, chat UI, project and team flows |
| Desktop shell | `apps/desktop/` | Tauri (Rust) | Desktop packaging and shell integration |

There is one important boundary in the current codebase:

- `server/` handles platform-domain concerns only and must not implement document CRUD
- `apps/app-backend/` owns documents, knowledge, chat, plugins, import/export, and other application-domain capabilities

## Repository Layout

```text
./
├── server/                  # Go platform backend
├── apps/
│   ├── app-backend/         # TypeScript application backend
│   ├── web/                 # Web frontend
│   └── desktop/             # Tauri desktop client
├── packages/
│   ├── doc-editor/          # Rich text and block editor package
│   ├── plugin-sdk-backend/  # Plugin backend SDK
│   ├── plugin-sdk-shared/   # Shared plugin types
│   ├── plugin-sdk-web/      # Plugin frontend SDK
│   └── shared/              # Shared types and utilities
├── ddl/                     # Initial SQL and migrations
├── deploy/                  # Helm, Kubernetes, and Docker assets
├── docs/                    # Architecture and design docs
├── openspec/                # Document-format specs
├── scripts/                 # Development and release scripts
└── tests/                   # Harnesses, fixtures, and invariant tests
```

## Key Concepts

### 1. Owner Scope

Projects use an owner-scope model and support both personal and team ownership:

- `ownerType`: `personal` or `team`
- `ownerKey`: `me`, a user ID, a team slug, or a team ID
- The frontend commonly uses `projectRef = ownerType::ownerKey::projectKey`
- Project-scoped application APIs follow:
  `projects/:ownerType/:ownerKey/:projectKey/...`

### 2. Documents and Knowledge

The application backend is responsible for:

- Document CRUD, tree structure, move, import, export, and optimize flows
- Multi-granularity indexing for `document / section / block / code`
- Hybrid retrieval and RAG
- Document-aware chat tools and skill execution

### 3. Plugin System

The current mainline implementation is `plugins-v2`:

- Plugin installation, enablement, user settings, and audit logs
- Document event hooks such as `document.create`, `document.update`, and `document.delete`
- Frontend and backend SDKs in `packages/plugin-sdk-*`

## Local Development

### Prerequisites

Recommended local environment:

- Node.js `22+`
- Go `1.25.2`
- PostgreSQL
- `pnpm` or `npm` for the workspace

Install dependencies:

```bash
pnpm install
```

If you prefer `npm`, you can also run:

```bash
npm install
```

### Start Services

The common local development setup is:

```bash
make run-server
make run-app-backend
make run-app-web
```

Default roles and URLs:

- `server`: platform APIs, usually `http://localhost:8080`
- `app-backend`: documents and AI capabilities, usually `http://localhost:4870`
- `app-web`: web frontend, usually `http://localhost:1420`

To run the desktop shell:

```bash
make run-app-desktop
```

### Configuration Notes

Common application-backend variables live in `apps/app-backend/.env` or `apps/app-backend/.env.local`, including:

- `DATABASE_URL`
- `ZEUS_DATA_ROOT`
- `APP_MODE`
- `AUTH_ENABLED`
- `DEFAULT_USER_ID`
- `JWT_SECRET`
- `SYSTEM_DOCS_DIR`

Common Go `server` variables include:

- `ZEUS_CONFIG_PATH`
- `ZEUS_PORT`

## Common Commands

### Frontend and Editor

```bash
npm run test:unified-editor
npm run doctor:doc-flow
npm run eval:doc-flow:smoke
npm run eval:chat:smoke
```

### API, Harnesses, and Invariants

```bash
npm run eval:doc-flow:api
npm run eval:chat:api
npm run eval:project-scope:api
npm run eval:plugins:api
npm run test:invariants
```

### Deployment and Dependencies

```bash
NAMESPACE=test make start-deps-dev
NAMESPACE=test make start-all
NAMESPACE=test make stop-all
```

### OCR

```bash
make build-paddleocr-image
make run-paddleocr-docker
make stop-paddleocr-docker
```

## Test Conventions

If you change frontend-related code, run automated verification before submitting. Current repo conventions include:

- Frontend interaction changes should run Playwright regression checks
- Playwright should use the fixed account in `output/playwright/test-account.json`
- Do not hardcode personal credentials in temporary test scripts

## Documentation Index

Recommended starting points:

- `docs/architecture/README.md`: architecture index
- `docs/architecture/document-flow.md`: document page, tree, editor, comments, and lock state
- `docs/architecture/chat.md`: chat domain architecture
- `docs/architecture/project-scope.md`: owner-scope and project resolution
- `docs/architecture/plugins.md`: plugin runtime and installation model
- `docs/plugin-development-guide.md`: plugin development workflow
- `openspec/specs/document-format/`: document JSON and Tiptap structure rules
- `ddl/sql/README.md`: database initialization and migration notes

## Deployment Notes

Deployment-related assets live in:

- `deploy/helm/`: Helm chart and values files
- `deploy/harbor/README.md`: registry-related notes
- `scripts/release/`: desktop and mobile packaging scripts

## Development Constraints

To avoid common mistakes:

- Do not add document CRUD to `server/`
- New project-level APIs must use scoped routes instead of the old `/api/projects/:key/...` shape
- The frontend must not bypass owner scope by manually constructing project keys incorrectly
- Read `openspec/specs/document-format/` before changing the document format

## Suggested Reading Order

If this is your first time in the repo, start with:

1. `README.md`
2. `AGENTS.md`
3. `docs/architecture/README.md`
4. `apps/web/src/App.tsx`
5. `apps/app-backend/src/router.ts`
6. `server/internal/api/handler/router.go`
