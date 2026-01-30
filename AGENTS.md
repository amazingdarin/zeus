# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-30
**Branch:** main

## OVERVIEW

Zeus 是一个智能文档管理系统，采用分层架构设计：

| 层级 | 目录 | 技术栈 | 职责 |
|------|------|--------|------|
| 平台后端 | server/ | Go (Gin/GORM/Postgres) | 多租户、项目管理、认证授权 |
| 应用后端 | apps/app-backend/ | TypeScript (Express) | 文档 CRUD、知识库索引、文件转换、Git导入 |
| 应用前端 | apps/web/ | React/Vite/Ant Design | Web 端用户界面 |
| 桌面应用 | apps/desktop/ | Tauri (Rust) | 桌面端外壳 |

部署：Helm Charts + Kubernetes，本地开发使用 Makefile 辅助命令。

## STRUCTURE
```
./
├── server/              # Go 平台后端 (多租户/项目管理)
├── apps/
│   ├── app-backend/     # TypeScript 应用后端 (文档/知识库/Git/LLM)
│   ├── web/             # React 应用前端
│   └── desktop/         # Tauri 桌面外壳
├── packages/
│   ├── doc-editor/      # Tiptap 富文本编辑器库
│   └── shared/          # 前后端共享工具库
├── deploy/              # Helm charts + Dockerfiles
├── ddl/sql/             # 数据库 schema
└── scripts/             # 本地开发脚本
```

## ARCHITECTURE

### 平台后端 (server/)

Go 服务端，负责平台级功能：

```
server/internal/
├── api/handler/         # Gin HTTP 路由与处理器
├── modules/
│   └── project/         # 项目管理 (多租户)
├── repository/          # 数据访问层 (Postgres)
├── infra/               # 外部适配器 (Git/S3)
└── domain/              # 领域模型
```

| 模块 | 路径 | 职责 |
|------|------|------|
| 项目管理 | modules/project | 项目 CRUD、系统配置 |
| Git 客户端 | infra/gitclient | Git 仓库读写操作 |
| 对象存储 | infra/objectstorage | S3/本地文件存储 |

### 应用后端 (apps/app-backend/)

TypeScript Express 服务，负责核心业务：

```
apps/app-backend/src/
├── index.ts             # 服务入口
├── router.ts            # API 路由定义
├── db/
│   └── postgres.ts      # PostgreSQL 连接池
├── storage/
│   ├── types.ts         # 文档类型定义
│   ├── document-store.ts # 文档 CRUD (文件系统)
│   └── index-manager.ts # 内存索引管理
├── knowledge/
│   ├── chunker.ts       # 文档分块
│   ├── fulltext-index.ts # 全文索引 (tsvector)
│   ├── embedding-index.ts # 向量索引 (pgvector)
│   └── search.ts        # 统一搜索接口
└── services/
    ├── convert.ts       # 文档格式转换 (docx/pdf/html → markdown)
    ├── fetch-url.ts     # URL 抓取与解析
    └── import-git.ts    # Git 仓库批量导入
```

| API | 功能 |
|-----|------|
| GET /api/projects/:key/documents | 列出子文档 |
| GET /api/projects/:key/documents/:id | 获取文档 |
| GET /api/projects/:key/documents/:id/hierarchy | 获取层级链 |
| POST /api/projects/:key/documents | 创建文档 |
| PUT /api/projects/:key/documents/:id | 更新文档 |
| DELETE /api/projects/:key/documents/:id | 删除文档 |
| PATCH /api/projects/:key/documents/:id/move | 移动文档 |
| POST /api/projects/:key/documents/import | 文件导入 |
| POST /api/projects/:key/documents/import-git | Git 仓库导入 |
| POST /api/projects/:key/documents/fetch-url | URL 抓取 |
| POST /api/projects/:key/convert | 文档格式转换 |
| POST /api/projects/:key/knowledge/search | 知识库搜索 |

### 应用前端 (apps/web/)

React + Vite 单页应用：

```
apps/web/src/
├── pages/               # 路由页面
├── components/          # 业务组件
├── api/                 # API 客户端封装
├── context/             # React Context (项目上下文)
├── hooks/               # 自定义 Hooks
└── layout/              # 布局组件
```

### 共享包 (packages/)

| 包 | 路径 | 用途 |
|---|------|------|
| doc-editor | packages/doc-editor | Tiptap 富文本编辑器、自定义节点、UI 组件 |
| shared | packages/shared | 前后端共用的工具函数和类型 |

## WHERE TO LOOK

| 任务 | 位置 | 说明 |
|------|------|------|
| Go 服务入口 | server/cmd/zeus/main.go | 启动 HTTP 服务 |
| Go 服务装配 | server/internal/app/bootstrap.go | DI + 路由注册 |
| Go API 路由 | server/internal/api/handler/router.go | 项目管理路由 |
| 应用后端入口 | apps/app-backend/src/index.ts | Express 服务启动 |
| 应用后端路由 | apps/app-backend/src/router.ts | 文档/知识库 API 路由 |
| 文档存储 | apps/app-backend/src/storage/ | 文档 CRUD + 索引管理 |
| 知识库索引 | apps/app-backend/src/knowledge/ | 全文/向量索引 |
| 前端入口 | apps/web/src/main.tsx | React 应用入口 |
| 文档编辑器 | packages/doc-editor/src | Tiptap 编辑器库 |
| 数据库 Schema | ddl/sql/init.sql | 表结构 + 索引 |
| Helm 部署 | deploy/helm | Charts + Values |
| Tauri 桌面 | apps/desktop/src/main.rs | 桌面外壳入口 |

## CODE MAP

### 平台后端关键符号

| 符号 | 类型 | 位置 | 作用 |
|------|------|------|------|
| main | func | server/cmd/zeus/main.go | 启动服务 |
| BuildRouter | func | server/internal/app/bootstrap.go | DI + 路由组装 |
| RegisterRoutes | func | server/internal/api/handler/router.go | 注册 Gin 路由 |
| ProjectService | interface | modules/project/service | 项目管理接口 |

### 应用后端关键符号

| 符号 | 类型 | 位置 | 作用 |
|------|------|------|------|
| buildRouter | func | apps/app-backend/src/router.ts | 构建 Express 路由 |
| documentStore | object | apps/app-backend/src/storage/document-store.ts | 文档 CRUD |
| indexManager | class | apps/app-backend/src/storage/index-manager.ts | 内存索引管理 |
| fulltextIndex | object | apps/app-backend/src/knowledge/fulltext-index.ts | 全文索引 |
| embeddingIndex | object | apps/app-backend/src/knowledge/embedding-index.ts | 向量索引 |
| knowledgeSearch | object | apps/app-backend/src/knowledge/search.ts | 统一搜索 |
| convertDocument | func | apps/app-backend/src/services/convert.ts | 文档格式转换 |
| importGit | func | apps/app-backend/src/services/import-git.ts | Git 仓库导入 |

## CONVENTIONS

### 架构规范
- Go server 仅负责多租户/项目管理，不处理文档操作
- 文档操作全部由 app-backend 处理
- 前端统一通过 app-backend 访问 API

### 存储结构
文档存储在文件系统中：
```
{REPO_ROOT}/{projectKey}/docs/
├── api-guide.json           # 文档内容
├── api-guide/               # 子文档目录
│   ├── authentication.json
│   └── .index               # 排序索引 ["doc-id-1", "doc-id-2"]
└── .index
```

### 代码风格
- Go: 标准 Go 风格，使用 GORM 作为 ORM
- TypeScript: ESM 模块，async/await 风格
- React: 函数组件 + Hooks

### Helm Values 文件
- `values.deps.yaml`: 仅依赖服务 (Postgres/RustFS)
- `values.deps-dev.yaml`: 开发模式依赖 (hostNetwork)
- `values.full.yaml`: 完整部署

## ANTI-PATTERNS

- **禁止** 在 Go server 中处理文档操作，应使用 app-backend
- **禁止** 删除 `apps/desktop/src/main.rs` 中的 Windows 控制台抑制标志
- **禁止** 在前端直接调用 Go server 的文档 API

## COMMANDS

```bash
# 开发运行
make run-server               # 运行 Go 平台后端
make run-app-backend          # 运行 TypeScript 应用后端
make run-app-web              # 运行 React 前端
make run-app-desktop          # 运行 Tauri 桌面应用

# Docker 镜像构建
make build-postgres-image     # 构建 Postgres 镜像 (含中文分词)
make build-backend-image      # 构建 Go 后端镜像
make build-frontend-image     # 构建前端镜像

# Helm 部署
NAMESPACE=test make start-deps      # 启动依赖服务
NAMESPACE=test make start-deps-dev  # 启动依赖 (开发模式)
NAMESPACE=test make start-all       # 启动全部服务
NAMESPACE=test make stop-all        # 停止服务
NAMESPACE=test make clean-all       # 清理命名空间

# 测试
make test-integration         # 运行集成测试
```

## ENVIRONMENT VARIABLES

### App Backend
```bash
APP_BACKEND_PORT=4870          # 服务端口
DATABASE_URL=postgres://...    # PostgreSQL 连接字符串
EMBEDDING_API_URL=http://...   # Embedding API 地址
EMBEDDING_MODEL=nomic-embed-text # Embedding 模型名
REPO_ROOT=./data/repos         # 文档存储根目录
```

## NOTES

- `resources/` 目录包含测试夹具和大型构建产物，代码导航时可忽略
- `apps/desktop/target/` 是 Rust 构建输出，可忽略
- 数据库使用 pgvector 扩展支持向量检索，zhparser 支持中文全文检索
