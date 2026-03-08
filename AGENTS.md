# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-11
**Branch:** codex/deploy-k3s-langfuse-harbor

## NAVIGATION

Use this file as the repository navigation layer, not the only source of truth.

- Architecture index: `docs/architecture/README.md`
- Eval index: `docs/evals/README.md`
- Active design and implementation plans: `docs/plans/`
- Document-flow architecture: `docs/architecture/document-flow.md`
- Document-flow evals: `docs/evals/document-flow.md`
- Review evidence runbook: `docs/runbooks/review-with-harness-evidence.md`
- Merge readiness runbook: `docs/runbooks/merge-readiness.md`

When a task is domain-specific, prefer the domain docs above before reading the entire root guide.

## OVERVIEW

Zeus 当前是一个分层的文档与 AI 协作系统，核心由 4 层组成：

| 层级 | 目录 | 技术栈 | 主要职责 |
|------|------|--------|----------|
| 平台后端 | `server/` | Go + Gin + GORM + Postgres | 用户/团队/项目管理、认证与租户边界 |
| 应用后端 | `apps/app-backend/` | TypeScript + Express + Postgres | 文档存储、知识索引、RAG、Chat Agent、插件、PPT/OCR |
| 应用前端 | `apps/web/` | React + Vite + Ant Design | Web UI、项目/文档/团队/聊天交互 |
| 桌面壳 | `apps/desktop/` | Tauri (Rust) | 打包桌面端并承载 Web 前端 |

当前实现中，Go `server` 与 TS `app-backend` 职责明确分离：
- `server` 管平台与租户（auth/user/team/project）
- `app-backend` 管文档与 AI 能力（docs/knowledge/skills/plugins/chat/ppt/ocr）

## STRUCTURE

```text
./
├── server/                      # Go 平台后端
├── apps/
│   ├── app-backend/             # TS 应用后端
│   ├── web/                     # React 前端
│   └── desktop/                 # Tauri 桌面壳
├── packages/
│   ├── doc-editor/              # 编辑器组件
│   ├── plugin-sdk-backend/      # 插件后端 SDK
│   ├── plugin-sdk-shared/       # 插件共享类型/协议
│   ├── plugin-sdk-web/          # 插件前端 SDK
│   └── shared/                  # 通用工具与类型
├── ddl/sql/                     # init + migrations
├── deploy/                      # Helm/K8s/Docker
├── openspec/                    # 技术规范（文档格式等）
└── scripts/                     # 本地开发脚本
```

## ARCHITECTURE

### 1) 平台后端 (`server/`)

入口与装配：
- `server/cmd/zeus/main.go`
- `server/internal/app/bootstrap.go`
- `server/internal/api/handler/router.go`

模块：
- `internal/modules/auth`：注册/登录/刷新/会话
- `internal/modules/user`：用户资料与密码
- `internal/modules/team`：团队、成员、邀请、join-link
- `internal/modules/project`：项目创建与列表（owner scope）

要点：
- 路由前缀是 `/api`
- 受保护路由通过 JWT 中间件
- 项目写入落在 owner（personal/team）作用域
- 负责初始化 Git bare repo 与项目 scaffold（`internal/modules/project/service/project/service.go`）

### 2) 应用后端 (`apps/app-backend/`)

入口：
- `apps/app-backend/src/index.ts`
- `apps/app-backend/src/router.ts`

核心目录：
- `storage/`：文档与附件文件存储
- `knowledge/`：多粒度索引、检索、RAPTOR、重建任务
- `services/`：convert/import/fetch/chat/draft/ocr/ppt/web-search 等
- `llm/`：provider 配置、skills、agent、MCP 适配
- `plugins-v2/`：插件安装、命令、hook、registry snapshot

关键实现变化（相对旧版）：
- 项目路由统一为 owner-scope：
  `projects/:ownerType/:ownerKey/:projectKey/...`
- `projectScopeMiddleware` 会做权限解析并改写 `projectKey` 为 scoped key：
  `ownerType::ownerId::projectKey`
- 插件系统主线是 `plugins-v2`，同时保留旧插件代码目录

### 3) 应用前端 (`apps/web/`)

入口：
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`

关键实现：
- 通过 `apps/web/src/config/api.ts` 按路径把 API 分发到 Go server 或 app-backend
- 开发态由 `apps/web/vite.config.ts` 自定义 proxy 转发
- 项目标识采用 `projectRef = ownerType::ownerKey::projectKey`
- 路由包含登录注册、文档、聊天、系统文档、团队、插件动态路由

### 4) 桌面应用 (`apps/desktop/`)

入口：
- `apps/desktop/src/main.rs`

注意：
- 文件顶部 Windows 控制台抑制标志不可删除

## API MAP

### Go server (`/api`)

- System: `GET /api/system`
- Auth: `/api/auth/register|login|logout|refresh|me`
- User: `/api/users/me`, `/api/users/:username`
- Team:
  - `/api/teams`
  - `/api/teams/:slug/members`
  - `/api/teams/:slug/invitations`
  - `/api/teams/:slug/join-links`
  - `/api/invite-links/:token`
  - `/api/invitations/pending`
- Project 管理：`GET/POST /api/projects`

### app-backend (`/api`)

公共：
- `GET /api/system-docs/tree|content|asset`
- `GET/PUT /api/settings/chat`
- `GET/PUT/DELETE/POST /api/settings/web-search...`
- `GET/POST /api/llm/*`
- `POST /api/ocr/parse`, `GET /api/ocr/available|status`
- `GET /api/ppt-templates`, `GET /api/ppt-service/status`
- `GET/POST/PATCH /api/skills*`
- `GET/POST/PATCH/DELETE /api/plugins/v2/*`

项目作用域（统一前缀）：
- `/api/projects/:ownerType/:ownerKey/:projectKey/documents*`
- `/api/projects/:ownerType/:ownerKey/:projectKey/knowledge/search`
- `/api/projects/:ownerType/:ownerKey/:projectKey/rag/rebuild*`
- `/api/projects/:ownerType/:ownerKey/:projectKey/chat/*`
- `/api/projects/:ownerType/:ownerKey/:projectKey/skills*`
- `/api/projects/:ownerType/:ownerKey/:projectKey/ppt-*`

文档相关能力包含：
- CRUD / move / hierarchy / tree / suggest
- import, import-file, import-git, fetch-url, convert
- optimize（同步 + 流式任务）
- favorites / recent-edits

## OWNER SCOPE & MULTI-TENANCY

实现文件：
- `apps/app-backend/src/middleware/project-scope.ts`
- `apps/app-backend/src/project-scope.ts`

规则：
- `ownerType` 仅支持 `personal|team`
- personal ownerKey 仅允许 `me` 或当前 userId
- team ownerKey 通过 team slug/id 解析并校验成员权限
- project 查询以 `(key, owner_type, owner_id)` 为唯一范围
- 写操作要求 team 角色可写（owner/admin/member）

## DATA & STORAGE

### 文件系统布局（app-backend v2）

根目录推导：
- 优先 `ZEUS_DATA_ROOT`
- 兼容 `REPO_ROOT`（旧值是 `.../repos` 时会回退到其上级）

文档与资产：

```text
${ZEUS_DATA_ROOT}/
  users/{userId}/
    projects/{ownerType}/{ownerId}/{projectKey}/
      docs/
      assets/
```

插件用户态数据：

```text
${ZEUS_DATA_ROOT}/users/{userId}/.plugin/
  packages/
  settings/
  data/global/
  data/projects/{ownerType}/{ownerId}/{projectKey}/
  cache/
  runtime/
  tmp/
  installed.json
  registry-snapshot.json
```

### 数据库（`ddl/sql/init.sql` + migrations）

核心表（节选）：
- 平台域：`user`, `team`, `team_member`, `team_invitation`, `team_join_link`, `session`, `project`
- 索引域：`knowledge_fulltext_index`, `knowledge_embedding_index`, `knowledge_index`, `raptor_tree`, `document_summary_cache`
- AI/会话域：`llm_provider_config`, `skill_config`, `project_skill_config`, `chat_settings`, `chat_sessions`, `chat_messages`, `web_search_config`
- 偏好域：`document_favorites`, `document_recent_edits`
- PPT：`ppt_templates`
- 插件：`plugin_user_installation`, `plugin_user_settings`, `plugin_audit_log`, `plugin_user_registry_snapshot`

迁移文件（当前）：
- `001_add_user_team_system.sql`
- `002_add_team_join_link.sql`
- `002_update_project_unique_key.sql`
- `003_multi_granularity_index.sql`
- `004_add_owner_scope_columns.sql`
- `005_sync_init_coverage.sql`
- `006_add_ppt_templates.sql`
- `007_plugin_system.sql`
- `008_plugin_system_v2.sql`

## KNOWLEDGE / RAG / AGENT

知识检索：
- `knowledge/index-store.ts`：多粒度统一索引（document/section/block/code）
- `knowledge/search.ts`：fulltext/vector/hybrid 检索，hybrid 采用 RRF
- `knowledge/raptor.ts`：层次树与摘要缓存
- `knowledge/rebuild-task.ts`：全量/单文档重建任务

Agent/Skills：
- 内置技能：`llm/skills/document-skills.ts`
- Anthropic Skills 扫描：`./data/skills` + `~/.zeus/skills`
- MCP 工具目录：`llm/agent/mcp-client-manager.ts`（默认 discover-only）
- 统一技能目录：`llm/agent/skill-catalog.ts`（native + anthropic + mcp + plugin）

插件：
- 主线实现：`plugins-v2/manager.ts`
- 文档事件 hook：`document.create|update|delete|move|import|optimize`
- SDK 包：`packages/plugin-sdk-{shared,backend,web}`

## RUNTIME MODES & AUTH

### app-backend

配置文件：`apps/app-backend/src/config.ts`

- `APP_MODE=standalone|multi-tenant`
- `AUTH_ENABLED` 与 `PROJECT_ISOLATION` 可覆盖默认行为
- `DEFAULT_USER_ID` 用于 standalone 或未鉴权回退

说明：
- `authMiddleware` 已实现（JWT 验证）
- 当前路由主要依赖 `getUserId()`（无用户时回退 `DEFAULT_USER_ID`）

### server

- `ZEUS_CONFIG_PATH`：Go 配置文件路径（默认 `config.yaml`）
- `ZEUS_PORT`：HTTP 端口（默认 `8080`）

## DEPLOY & COMMANDS

### 本地开发

```bash
make run-server
make run-app-backend
make run-app-web
make run-app-desktop
```

### 镜像与 OCR

```bash
make build-postgres-image
make build-backend-image
make build-frontend-image
make build-paddleocr-image
make run-paddleocr-docker
make stop-paddleocr-docker
```

### Helm / K8s

```bash
NAMESPACE=test make start-deps
NAMESPACE=test make start-deps-dev
NAMESPACE=test make start-all
NAMESPACE=test make stop-all
NAMESPACE=test make clean-all
```

values 文件：
- `deploy/helm/values.deps.yaml`：仅依赖（默认关闭 backend/frontend/langfuse/banana-slides）
- `deploy/helm/values.deps-dev.yaml`：开发依赖（NodePort/hostNetwork 场景）
- `deploy/helm/values.full.yaml`：完整部署（开启 backend/frontend/langfuse/banana-slides）

## ENVIRONMENT VARIABLES

### app-backend（高频）

```bash
APP_BACKEND_PORT=4870
APP_BACKEND_CORS=
DATABASE_URL=postgres://...
ZEUS_DATA_ROOT=./data
REPO_ROOT=./data/repos                # 兼容旧配置
APP_MODE=standalone                   # or multi-tenant
AUTH_ENABLED=false
JWT_SECRET=
AUTH_SERVER_URL=http://localhost:8080
PROJECT_ISOLATION=false
DEFAULT_USER_ID=default-user
SYSTEM_DOCS_DIR=./docs
ENCRYPTION_KEY=
```

### LLM / Search / Agent

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434/v1
COHERE_API_KEY=
AGENT_ALLOW_SHELL=false
AGENT_ALLOW_MCP_WRITE=false
AGENT_ENABLE_MCP_RUNTIME=false
MCP_TOOLS_JSON=[]
MCP_TOOLS_FILE=
```

### Plugins / Observability / PPT

```bash
PLUGIN_ROOT=
PLUGIN_STORE_INDEX_URL=
PLUGIN_STORE_CATALOG_FILE=
PLUGIN_STORE_REQUIRE_SIGNATURE=false
PLUGIN_STORE_PUBLIC_KEY_PEM=
PLUGIN_MAX_EXECUTION_MS=20000
PLUGIN_WORKER_IDLE_MS=120000
PLUGIN_APP_BACKEND_VERSION=0.1.0
PLUGIN_WEB_VERSION=0.1.0
PLUGIN_STORE_LOCAL_ROOT=

LANGFUSE_ENABLED=true
LANGFUSE_HOST=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=

BANANA_SLIDES_URL=http://banana-slides:8080
BANANA_SLIDES_API_KEY=
```

## WHERE TO LOOK

| 任务 | 位置 |
|------|------|
| Go 服务入口 | `server/cmd/zeus/main.go` |
| Go 依赖装配 | `server/internal/app/bootstrap.go` |
| Go 路由注册 | `server/internal/api/handler/router.go` |
| 项目服务实现 | `server/internal/modules/project/service/project/service.go` |
| app-backend 入口 | `apps/app-backend/src/index.ts` |
| app-backend 路由 | `apps/app-backend/src/router.ts` |
| project scope 解析 | `apps/app-backend/src/middleware/project-scope.ts` |
| 文档存储实现 | `apps/app-backend/src/storage/document-store.ts` |
| 存储路径策略 | `apps/app-backend/src/storage/paths.ts` |
| 多粒度索引 | `apps/app-backend/src/knowledge/index-store.ts` |
| 统一检索 | `apps/app-backend/src/knowledge/search.ts` |
| 插件 v2 管理器 | `apps/app-backend/src/plugins-v2/manager.ts` |
| 插件开发步骤 | `docs/plugin-development-guide.md` |
| Agent 技能目录 | `apps/app-backend/src/llm/agent/skill-catalog.ts` |
| 前端 API 路由分流 | `apps/web/src/config/api.ts` |
| 前端开发代理 | `apps/web/vite.config.ts` |
| 桌面入口 | `apps/desktop/src/main.rs` |
| 初始化 schema | `ddl/sql/init.sql` |
| SQL 迁移目录 | `ddl/sql/migrations/` |

## OPENSPEC

文档格式规范在 `openspec/specs/document-format/`：
- `document-structure.spec.md`
- `block-types.spec.md`
- `marks.spec.md`
- `examples/`

生成/编辑文档 JSON 时必须遵循 Tiptap 节点结构与嵌套规则。

## CONVENTIONS

- Go server 只做平台管理，不做文档 CRUD
- 文档与 AI 相关 API 由 app-backend 承担
- 前端通过统一 API 封装访问，不绕过作用域约束
- 新增项目级 API 必须沿用 scoped 路由：
  `projects/:ownerType/:ownerKey/:projectKey/...`
- 开发 `plugins-v2` 时，先阅读并按 `docs/plugin-development-guide.md` 的“开发步骤”执行

## FRONTEND TEST RULE

- 只要修改了前端相关代码（至少包含 `apps/web/`、`packages/doc-editor/`、`apps/desktop/` 中承载前端交互的改动），提交前必须执行 `playwright-cli` 无头模式进行自动化测试。
- `playwright-cli` 测试统一使用固定测试账号，凭据文件路径：`output/playwright/test-account.json`。
- 新增或修改前端功能时，测试脚本必须从 `output/playwright/test-account.json` 读取账号信息进行登录，禁止临时手填个人账号。
- 开始文档主链路相关开发前，先运行 `npm run doctor:doc-flow` 检查 `server`、`app-backend`、`web`、PostgreSQL 对齐状态和测试账号是否可用。

## ANTI-PATTERNS

- **禁止** 在 Go server 中实现文档 CRUD
- **禁止** 使用旧路由模式 `/api/projects/:key/...` 作为新增接口
- **禁止** 删除 `apps/desktop/src/main.rs` 顶部 Windows 抑制标志
- **禁止** 在前端直接拼接绕过 owner scope 的 project key

## NOTES

- `resources/` 与 `apps/desktop/target/` 多为夹具/构建产物，代码导航可忽略
- `ddl/sql/init.sql` 已覆盖多数 schema；变更仍需新增 migration 文件
- 若你在做插件能力，优先看 `docs/plugin-development-guide.md`、`plugins-v2/` 与 `packages/plugin-sdk-*`
