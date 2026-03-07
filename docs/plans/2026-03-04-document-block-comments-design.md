# 文档块评论功能设计（Document Block Comments）

## 1. 背景与目标

当前 Zeus 已具备文档块级能力（按 `blockId` 读取/更新块、代码块执行、块级操作菜单），但缺少协作评论机制。  
本次目标是在**不修改文档本体结构**的前提下，新增“块级多线程评论”，支持项目成员协作讨论与问题闭环。

核心目标：

- 对任意文档块（`blockId`）发起评论线程
- 每块支持多个独立线程（multi-thread）
- 支持回复、解决/重开、消息删除（受权限控制）
- 评论数据与文档 JSON 完全分离，独立持久化到数据库

## 2. 已确认范围（MVP）

- 可见性：项目成员可见（协作评论）
- 线程模型：块级多线程
- 锚点：仅锚定“整个块”（`docId + blockId`）
- 存储边界：评论**不写入**文档文件，独立入库
- 锁定策略：文档锁定时仍允许评论/回复
- 通知策略：本期不接入消息中心，不做 @ 提醒

## 3. 非目标（本期不做）

- 块内文本范围锚点（字符级 selection anchor）
- 评论富文本（仅纯文本/轻量 markdown）
- 消息中心通知、邮件通知、@ 提醒
- 评论权限细粒度策略配置（按角色自定义）
- 评论版本历史与审计 UI

## 4. 总体架构

### 4.1 架构原则

- 路由沿用 owner scope：`/api/projects/:ownerType/:ownerKey/:projectKey/...`
- 评论域与文档域解耦：评论表独立，文档 JSON 不扩展评论字段
- 权限基于现有 project scope 和团队成员角色判定

### 4.2 数据流

1. 前端在块操作入口触发“评论”
2. 调用 app-backend 评论 API（带 scope + `docId + blockId`）
3. 后端校验 scope、文档存在、块存在、权限
4. 写入评论线程/消息表并返回线程数据
5. 前端局部刷新对应块评论状态（计数、线程列表）

## 5. 数据模型设计（独立数据库表）

> 说明：评论与文档本体分离，采用独立表持久化。

### 5.1 线程表 `document_block_comment_threads`

- `id` UUID PK
- `owner_type` TEXT NOT NULL
- `owner_id` TEXT NOT NULL
- `project_key` TEXT NOT NULL
- `doc_id` TEXT NOT NULL
- `block_id` TEXT NOT NULL
- `status` TEXT NOT NULL DEFAULT `open` (`open|resolved`)
- `created_by` TEXT NOT NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `resolved_by` TEXT NULL
- `resolved_at` TIMESTAMPTZ NULL

索引建议：

- `(owner_type, owner_id, project_key, doc_id, status, updated_at DESC)`
- `(owner_type, owner_id, project_key, doc_id, block_id, updated_at DESC)`

### 5.2 消息表 `document_block_comment_messages`

- `id` UUID PK
- `thread_id` UUID NOT NULL FK -> `document_block_comment_threads(id)` ON DELETE CASCADE
- `author_id` TEXT NOT NULL
- `content` TEXT NOT NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `deleted_at` TIMESTAMPTZ NULL（软删可选，MVP 可先硬删）

索引建议：

- `(thread_id, created_at ASC)`

## 6. API 设计

### 6.1 列表与详情

- `GET /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments`
  - query: `blockId?`, `status?`, `cursor?`, `limit?`
  - 返回线程摘要列表（可按块过滤）

- `GET /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId`
  - 返回单线程 + 消息列表

### 6.2 写操作

- `POST /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments`
  - body: `{ blockId, content }`
  - 创建线程并写入首条消息

- `POST /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId/messages`
  - body: `{ content }`
  - 追加回复

- `PATCH /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId`
  - body: `{ status: "open" | "resolved" }`
  - 线程解决/重开

- `DELETE /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/messages/:messageId`
  - 删除消息（作者或管理员）

## 7. 权限与业务规则

### 7.1 权限规则（已确认）

- 评论/回复：项目可写成员（owner/admin/member）
- 解决/重开：项目可写成员
- 删除消息：消息作者或项目管理员（admin/owner）

### 7.2 文档锁定规则

- 文档锁定仅限制正文写入，不限制评论写入
- 评论 API 不走 `assertDocumentUnlocked` 拦截

### 7.3 一致性规则

- 创建线程/回复前必须校验：文档存在、块存在
- `threadId/messageId` 必须属于当前 scope + 当前文档，防越权
- 若块后续被删，线程保留并在读取时标记 `orphaned`（可选扩展字段）

## 8. 前端交互设计

### 8.1 入口与呈现

- 在编辑器块级操作入口增加“评论”
- 块侧展示评论计数徽标（存在评论时）
- 点击后打开文档右侧评论侧栏（不改正文布局）

### 8.2 侧栏内容

- 顶部：当前块摘要（块类型 + 文本片段）
- 列表：该块下多线程评论
- 操作：新建线程、回复、解决/重开、删除消息（按 `canDelete`）

### 8.3 状态与页签协同

- `DocumentPage` 维护文档级评论状态映射（按 `docId`/`blockId`）
- 切换文档页签时恢复评论面板上下文（是否打开、当前块）
- 局部刷新优先，避免整页重载

## 9. 错误处理

- `BLOCK_NOT_FOUND`：提示“目标块不存在或已删除”
- `COMMENT_PERMISSION_DENIED`：提示无权限并收敛按钮显示
- `THREAD_NOT_FOUND/MESSAGE_NOT_FOUND`：提示后自动刷新当前块线程
- 网络错误：局部重试，不影响正文编辑流程

## 10. 测试策略

### 10.1 后端

- 单元测试：
  - scope 过滤
  - 文档/块存在性校验
  - 权限判定（评论/解决/删除）
  - 状态流转（open <-> resolved）
- 集成测试：
  - 线程与消息 CRUD
  - 跨 scope 越权访问拦截

### 10.2 前端

- reducer 单测：线程新增、回复、解决、删除
- API 单测：路径、参数、错误映射
- Playwright 回归（固定账号）：
  - 新建线程、回复、解决/重开、删除权限
  - 文档锁定时仍可评论
  - 切换文档后评论计数和列表恢复

## 11. 兼容性与迁移

- 新增 SQL migration，不影响文档存储格式
- 不改动已有文档 JSON schema
- 老文档无需迁移即可使用评论能力

## 12. 风险与后续扩展

主要风险：

- 高并发下评论计数与列表的一致性（需乐观更新+回源修正）
- 块删除后线程展示语义（需明确 orphaned 呈现）

后续可扩展：

- @ 提醒 + 消息中心事件
- 块内文本范围锚点
- 评论筛选（未解决优先、我参与的评论）
- 评论导出与审计日志
