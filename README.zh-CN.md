# Zeus

[English](README.md) | 简体中文

Zeus 是一个分层的文档与 AI 协作系统，围绕项目文档、知识库、检索增强、聊天代理、插件扩展和多端使用场景构建。当前仓库采用 monorepo 组织，平台能力、文档与 AI 能力、Web 前端和桌面端分别独立实现。

## 核心能力

- 文档树、块编辑器、评论、垃圾箱、导入导出、版本与同步相关能力
- 知识库索引、全文检索、向量检索、RAG、RAPTOR 树构建
- 文档上下文聊天、技能调用、MCP 适配、插件扩展
- 团队、项目、成员、邀请、认证与多租户 owner scope 管理
- Web 前端与 Tauri 桌面端双端承载

## 分层架构

| 层级 | 目录 | 技术栈 | 主要职责 |
| --- | --- | --- | --- |
| 平台后端 | `server/` | Go + Gin + GORM + Postgres | 用户、团队、项目、认证、租户边界 |
| 应用后端 | `apps/app-backend/` | TypeScript + Express + Postgres | 文档、知识索引、RAG、Chat Agent、插件、OCR、PPT |
| 应用前端 | `apps/web/` | React + Vite + Ant Design | 文档页、聊天页、项目与团队 UI |
| 桌面壳 | `apps/desktop/` | Tauri (Rust) | 桌面打包与本地壳层能力 |

当前实现里有一个很重要的边界：

- `server/` 只负责平台域，不实现文档 CRUD
- `apps/app-backend/` 负责文档、知识库、聊天、插件、导入导出等应用能力

## 目录概览

```text
./
├── server/                  # Go 平台后端
├── apps/
│   ├── app-backend/         # TS 应用后端
│   ├── web/                 # Web 前端
│   └── desktop/             # Tauri 桌面端
├── packages/
│   ├── doc-editor/          # 富文本/块编辑器组件
│   ├── plugin-sdk-backend/  # 插件后端 SDK
│   ├── plugin-sdk-shared/   # 插件共享类型
│   ├── plugin-sdk-web/      # 插件前端 SDK
│   └── shared/              # 共享工具与类型
├── ddl/                     # 初始化 SQL 与迁移
├── deploy/                  # Helm/K8s/Docker 部署资源
├── docs/                    # 架构文档与设计文档
├── openspec/                # 文档格式规范
├── scripts/                 # 开发与发布脚本
└── tests/                   # harness、fixture 与不变量测试
```

## 关键概念

### 1. Owner Scope

项目采用 owner scope 模型，支持个人与团队两类归属：

- `ownerType`: `personal` 或 `team`
- `ownerKey`: `me`、用户 ID、团队 slug 或团队 ID
- 前端常用 `projectRef = ownerType::ownerKey::projectKey`
- 应用后端项目级接口统一使用：
  `projects/:ownerType/:ownerKey/:projectKey/...`

### 2. 文档与知识库

应用后端负责：

- 文档 CRUD、树结构、移动、导入、导出、优化
- 多粒度知识索引：`document / section / block / code`
- Hybrid 检索与 RAG
- 文档相关聊天工具与技能调用

### 3. 插件系统

当前主线是 `plugins-v2`：

- 插件安装、启停、用户配置、审计日志
- 文档事件 hook：`document.create`、`document.update`、`document.delete` 等
- 前后端 SDK 位于 `packages/plugin-sdk-*`

## 本地开发

### 运行前提

建议准备以下环境：

- Node.js `22+`
- Go `1.25.2`
- PostgreSQL
- `pnpm` 或 `npm`（仓库为 workspace 结构）

安装依赖：

```bash
pnpm install
```

如果你使用 `npm`，也可以在根目录执行：

```bash
npm install
```

### 启动服务

最常用的本地开发方式：

```bash
make run-server
make run-app-backend
make run-app-web
```

默认职责与访问地址：

- `server`: 平台接口，默认 `http://localhost:8080`
- `app-backend`: 文档与 AI 能力，默认 `http://localhost:4870`
- `app-web`: Web 前端，默认 `http://localhost:1420`

如需桌面端：

```bash
make run-app-desktop
```

### 开发配置提示

应用后端常见环境变量位于 `apps/app-backend/.env` 或 `apps/app-backend/.env.local`，高频项包括：

- `DATABASE_URL`
- `ZEUS_DATA_ROOT`
- `APP_MODE`
- `AUTH_ENABLED`
- `DEFAULT_USER_ID`
- `JWT_SECRET`
- `SYSTEM_DOCS_DIR`

Go `server` 侧常见变量：

- `ZEUS_CONFIG_PATH`
- `ZEUS_PORT`

## 常用命令

### 前端与编辑器

```bash
npm run test:unified-editor
npm run doctor:doc-flow
npm run eval:doc-flow:smoke
npm run eval:chat:smoke
```

### API / Harness / Invariants

```bash
npm run eval:doc-flow:api
npm run eval:chat:api
npm run eval:project-scope:api
npm run eval:plugins:api
npm run test:invariants
```

### 部署与依赖

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

## 测试约定

如果修改了前端相关代码，提交前应执行自动化验证。仓库当前约定：

- 前端交互改动需要运行 Playwright 回归
- Playwright 统一使用 `output/playwright/test-account.json` 中的固定测试账号
- 不要在脚本里临时硬编码个人账号

## 文档索引

推荐从以下文档进入：

- `docs/architecture/README.md`：架构文档入口
- `docs/architecture/document-flow.md`：文档页、文档树、编辑器、评论、锁状态
- `docs/architecture/chat.md`：聊天域架构
- `docs/architecture/project-scope.md`：owner scope 与项目解析
- `docs/architecture/plugins.md`：插件运行时与安装体系
- `docs/plugin-development-guide.md`：插件开发步骤
- `openspec/specs/document-format/`：文档 JSON / Tiptap 结构规范
- `ddl/sql/README.md`：数据库初始化与迁移说明

## 部署说明

部署相关资源位于：

- `deploy/helm/`：Helm Chart 与 values
- `deploy/harbor/README.md`：镜像仓库相关说明
- `scripts/release/`：桌面端与移动端打包脚本

## 开发约束

为了减少踩坑，建议先了解这些约束：

- 不要在 `server/` 中新增文档 CRUD
- 新增项目级 API 时，沿用 scoped 路由，而不是旧的 `/api/projects/:key/...`
- 前端不要绕过 owner scope 手工拼接 project key
- 文档格式变更前，先阅读 `openspec/specs/document-format/`

## 适合先看的文件

如果你是第一次进入这个仓库，建议按下面顺序阅读：

1. `README.md`
2. `AGENTS.md`
3. `docs/architecture/README.md`
4. `apps/web/src/App.tsx`
5. `apps/app-backend/src/router.ts`
6. `server/internal/api/handler/router.go`

