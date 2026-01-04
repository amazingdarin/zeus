# Zeus Project Guide
**Version 2.0**
**Purpose: Enforce Architecture & Coding Discipline**

所有工程师（包括 AI 代码生成器）必须严格遵守本规范。

---

## 0. 总体目标与当前阶段

Zeus 是一个全流程智能研发系统。当前阶段聚焦于 **知识库（Knowledge Base）与文档系统** 的基础能力（创建项目、文档读写、版本管理、搜索可派生）。

### 当前阶段核心决策（必须遵守）
- **Project（项目控制面）**：由 **数据库** 管理（PostgreSQL + GORM）
- **Knowledge Base（文档事实源）**：由 **Git 仓库** 管理（每项目一个 repo）
- **搜索/索引/RAG**：均为**派生能力**，不是事实源，可后续引入

---

## 1. Clean Architecture + Domain First

### 1.1 分层约束

推荐依赖方向：

`api(handler) → service → domain → repository / infra`

禁止：
- service 直接写 SQL / 直接操作 GORM（必须通过 repository）
- api 层写业务逻辑
- domain 依赖 infra（domain 只能是纯数据结构 + 规则）
- 在业务中直接调用 `os/exec git ...`（必须封装在 infra 层）

---

## 2. 当前阶段红线（必须遵守）

在 **文档上传、整理与规范化阶段**，系统必须遵守以下红线：

### 2.1 严格禁止
- ❌ 调用 LLM 对文档内容进行主观抽象、总结或系统事实生成
- ❌ 自动生成任何 Spec / 系统说明 / 架构结论
- ❌ 写入 `module_snapshot`
- ❌ 基于检索结果进行 RAG 推理/问答或决策输出
- ❌ 任何会引入“事实判断”“设计意图推断”的自动化行为

### 2.2 明确允许（受控）
- ✅ 原始文档与规范文档（TipTap Block JSON）的存储
- ✅ 文档元数据提取与整理（非语义判断）
- ✅ 文档类型与结构分类（规则/确定性算法）
- ✅ 候选模块推断（低风险、带置信度、不可作为事实）
- ✅ 可重建的搜索/索引（FTS/倒排）——**派生数据**

---

## 3. 数据与事实源边界（DB vs Git）

### 3.1 数据库（Control Plane）

数据库仅用于：
- Project 生命周期（create/list/get/update）
- Project -> Git repo 的绑定信息（repo_url/repo_name）
- 系统运行配置（如 Git server 地址、默认分支等）
- 派生索引（可选）：全文索引、搜索缓存（必须可重建）

数据库不得用于：
- 文档内容事实源
- 文档元信息事实源（标题/父子关系/tags 等应以 Git 为准）

### 3.2 Git（Knowledge Data Plane）

Git 仓库是文档系统事实源，用于：
- 文档内容 `content.json`
- 文档元信息 `.meta.json`
- 文档历史、diff、回滚（commit log）

---

## 4. Git 仓库规范（每项目一个 Repo）

### 4.1 Repo 命名
- Repo 名：`zeus-{project_key}.git`
- `project_key` 创建后不可修改
- 一个 Project 必须绑定一个 repo（DB 中记录 repo_url）

### 4.2 Repo 目录规范（强制）
```
/
├── README.md
├── .zeus/
│   └── project.json            # 可选（只读冗余，不作为主事实）
└── docs/
    ├── /
    │   ├── content.json         # TipTap 内容（仅内容）
    │   └── .meta.json           # 文档元信息（事实源）
    └── …
```

### 4.3 content.json 规范（强制）
content.json 只包含内容与内容元信息（不含 title/parent_id 等业务字段）：
```json
{
  "meta": {
    "zeus": true,
    "format": "tiptap",
    "schema_version": 1,
    "editor": "tiptap",
    "created_at": "RFC3339",
    "updated_at": "RFC3339"
  },
  "content": { "type": "doc", "content": [] }
}
```

Block ID（强烈建议）
- block-level 节点需要 attrs.id（uuid/nanoid）
- 用于定位、高亮、增量索引
- 如果暂未实现，解析阶段允许使用 node-path hash 兜底（但必须尽快补齐）

### 4.4 .meta.json 规范（强制）

.meta.json 为文档事实元信息，建议最小字段：
```
{
  "id": "doc-xxx",
  "slug": "system-design",
  "title": "系统设计说明",
  "parent": "root",
  "path": "/system-design",
  "created_at": "RFC3339",
  "updated_at": "RFC3339",
  "status": "draft",
  "tags": []
}
```

---

## 5. 目录结构（强制）
```
/cmd
/internal
  /api                 # Gin handlers / routing / request/response DTO
  /config              # Program config
  /service             # use-cases (business orchestration)
  /domain              # pure models + rules (no IO)
  /repository
    /postgres          # GORM repo for control-plane entities (Project, etc.)
    /git               # repo for knowledge plane (git operations, file read/write)
  /infra
    /gitclient         # low-level git operations (clone, pull, commit, push)
  /util
```

---

## 6. 服务与接口（推荐边界）

### 6.1 Service（面向用例）
- ProjectService（DB）
- KnowledgeService（Git）
- SearchIndexService（派生，可选）

### 6.2 Repository（面向数据源）
- ProjectRepository（GORM）
- KnowledgeRepository（Git-backed file store）
- GitClient（infra：clone/pull/commit/push）

---

## 7. API 规范（RESTful + 按模块划分）

路径统一前缀：`/api`

### Project（DB）
- `POST   /api/projects`
- `GET    /api/projects`
- `GET    /api/projects/{project_key}`

### Knowledge（Git）
- `GET    /api/projects/{project_key}/documents`            # list (from git)
- `GET    /api/projects/{project_key}/documents/{doc_id}`   # read (content+meta)
- `POST   /api/projects/{project_key}/documents`            # create (write files + commit)
- `PATCH  /api/projects/{project_key}/documents/{doc_id}`   # update (write files + commit)
- `GET    /api/projects/{project_key}/documents/{doc_id}/history`  # git log (optional)

---

## 8. Git 操作原则（必须）

所有写操作必须：
- pull --rebase（或等价策略）保持与远端一致
- 写文件（content.json / .meta.json）
- git add
- git commit
- git push

commit message 必须结构化：
- `docs: create <doc_id>`
- `docs: update <doc_id>`

任何 git 冲突必须显式处理并返回错误（禁止 silent overwrite）。
所有 git IO 必须封装在 infra/gitclient，业务层不得直接 exec。

---

## 9. 错误处理规范

- handler 返回统一错误结构：
  - code
  - message
  - request_id（可选）
- service 返回 domain error（不包含 HTTP）
- repository 负责将 infra error 转换为可识别错误类型

---

## 10. 日志与可观测（最低要求）

- 所有关键操作必须日志：
  - project create
  - repo init
  - doc create/update
  - git commit/push
- 结构化日志（json）
- request_id 贯穿 handler -> service -> repo

---

## 11. 安全与权限（当前阶段简化）

- 暂不实现复杂权限系统
- 但必须保留 project_key 作用域校验
- Git 访问凭据由服务端管理（SSH key），不得暴露给前端

---
