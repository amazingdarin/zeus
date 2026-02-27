# 文档 Git 版本管理设计（Design）

## 1. 背景与目标

当前 Zeus 文档能力已具备完整的文档操作事件（`document.create/update/delete/move/import/optimize`），但缺少可追溯的版本链路与多端同步机制。

本设计目标：

1. 为项目级 `docs/` 引入 Git 版本管理。
2. 基于登录态与配置切换“真相源”：
   - 未登录：本地仓库为真相源。
   - 已登录且开启自动同步：server 裸仓库为分发真相源。
3. 第一版冲突策略采用本地优先，允许强推覆盖远端。
4. 保持编辑体验优先，避免文档 API 被网络抖动阻塞。

## 2. 已确认的产品决策

1. 冲突策略：`本地优先`（分叉时 `push --force-with-lease`）。
2. 提交粒度：每次文档操作立即提交（1 操作 = 1 commit）。
3. 版本管理范围：项目级 `docs/` 目录。
4. 配置规则：
   - 提供“自动同步”配置。
   - 未登录时本地模式；登录并开启自动同步时远端模式。

## 3. 范围与非目标

### 3.1 范围（v1）

1. app-backend 内实现 Git 提交与同步管线。
2. 复用现有文档 after-hook 触发版本事件。
3. 增加通用配置项 `document_auto_sync`。
4. 打通项目进入时的同步收敛（`syncOnOpen`）。

### 3.2 非目标（v1）

1. 不实现可视化冲突合并 UI。
2. 不实现跨项目/跨目录细粒度策略。
3. 不引入复杂三方合并器。

## 4. 方案比较与选型

### 方案 A：写路径强同步（请求内 commit+push）

- 优点：一致性直观。
- 缺点：接口延迟高，网络故障直接影响编辑。

### 方案 B：异步同步管线（推荐）

- 优点：编辑链路稳定；可重试、可观测；适配高频 commit。
- 缺点：最终一致，不是请求级强一致。

### 方案 C：server 代提交流程

- 优点：集中治理。
- 缺点：跨服务耦合高，违背当前分层（文档能力在 app-backend）。

**结论：采用方案 B。**

## 5. 核心架构

### 5.1 组件

1. `document-version-service`（app-backend 新增）
   - 管理项目级 Git 仓库生命周期。
   - 负责 `commit`、`syncOnOpen`、`push`、失败重试。
2. `sync-policy-resolver`
   - 输入：登录态 + `documentAutoSync`。
   - 输出：`local_only` 或 `remote_enabled`。
3. 项目级串行队列（`project sync queue`）
   - 保证同一项目 Git 操作串行。
4. server 裸仓库（已有）
   - 作为登录+自动同步模式下的远端分发源。

### 5.2 分层边界

1. Go `server`：继续负责项目与裸仓库管理。
2. `apps/app-backend`：负责文档 Git 提交与同步调度。
3. 前端：仅负责配置与状态展示，不参与 Git 逻辑。

## 6. 数据模型与配置

## 6.1 配置模型（按用户）

新增表：`user_general_settings`

- `user_id TEXT PRIMARY KEY`
- `use_remote_knowledge_base BOOLEAN NOT NULL DEFAULT false`
- `document_auto_sync BOOLEAN NOT NULL DEFAULT false`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

说明：当前 `general_settings` 是全局单例，无法满足多用户独立偏好。版本同步配置必须用户级隔离。

### 6.2 API 扩展

1. `GET /api/settings/general`
   - 返回：`useRemoteKnowledgeBase`, `documentAutoSync`
2. `PUT /api/settings/general`（需登录）
   - 入参：`use_remote_knowledge_base?`, `document_auto_sync?`

### 6.3 状态存储策略

v1 不新增“版本状态表”，以 Git 状态为准：

- 本地：`HEAD`, `git status --porcelain`
- 远端：`ls-remote`

## 7. 端到端数据流

### 7.1 文档写操作流

1. 文档 API 成功写入存储。
2. 触发现有 `dispatchDocumentAfterHooks`。
3. `document-version-service.recordVersion(event, payload)`：
   - `git add docs/`
   - 生成 commit message
   - 提交 commit
4. 若 `syncMode=remote_enabled`：入队 `push` 任务。

### 7.2 项目进入同步流（`syncOnOpen`）

1. 进入项目触发一次同步检查。
2. `local_only`：跳过远端。
3. `remote_enabled`：比较本地与远端提交关系。
   - 分叉：本地优先强推（见冲突策略）。
   - 本地领先：push。
   - 远端领先且本地无提交：pull。

## 8. 冲突与失败处理

### 8.1 冲突策略（v1）

1. 分叉检测后执行 `git push --force-with-lease origin <branch>`。
2. 强推前打本地安全标签：`backup/pre-force-<timestamp>`。

### 8.2 重试与降级

1. 每项目任务队列状态：`pending/running/retrying/failed`。
2. 重试退避：`1s -> 2s -> 5s -> 10s -> 20s`（最多 5 次）。
3. 超限后写入 message center，提示“自动同步暂停，可手动重试”。

### 8.3 一致性语义

1. 本地写成功后即视为用户操作成功。
2. 远端同步为异步最终一致。

## 9. 安全与权限

1. 远端同步仅在“已登录 + 自动同步开启”可执行。
2. `PUT /settings/general` 保持 `authMiddleware` 保护。
3. team 项目同步沿用 `projectScopeMiddleware` 的写权限判定。
4. server 裸仓库访问建议使用短时令牌或内网白名单。

## 10. 可观测性

1. 结构化日志字段：
   - `projectRef`, `event`, `commit`, `syncMode`, `attempt`, `durationMs`, `result`, `error`
2. 前端显示状态：`已同步 / 同步中 / 同步失败`。
3. 统计指标（先日志聚合）：
   - commit 成功率、push 成功率、平均推送耗时、失败原因分布。

## 11. 测试策略

### 11.1 单元测试

1. `sync-policy-resolver`：登录态与配置组合覆盖。
2. `commit message builder`：不同事件模板覆盖。
3. `divergence handler`：本地优先强推路径覆盖。

### 11.2 集成测试

1. 文档操作触发 commit（create/update/delete/move/import/optimize）。
2. `remote_enabled` 下 push 成功与失败重试。
3. `syncOnOpen` 三种分支（本地领先/远端领先/分叉）。

### 11.3 回归测试

1. 文档 CRUD 性能回归（确认未显著退化）。
2. 登录/未登录配置行为回归。
3. team 项目权限回归。

## 12. 分阶段落地

### Phase 1（MVP）

1. 新增 `document-version-service` 并接入文档 after-hook。
2. 每次操作 commit。
3. 增加 `document_auto_sync` 配置与前后端 API。
4. `remote_enabled` 下 push（本地优先强推策略生效）。

### Phase 2（稳定性）

1. 引入项目级串行同步队列。
2. 引入重试与 message center 告警。
3. 增加 `syncOnOpen`。

### Phase 3（可运维）

1. 增加同步诊断接口（最近成功/失败/错误原因）。
2. 增加手动同步控制入口。
3. 完善审计日志与运维观察面。

## 13. 风险与后续演进

1. 风险：本地优先强推可能覆盖他端提交。
2. 缓解：
   - 强推前自动标签备份。
   - message center 明确提示覆盖行为。
3. 后续：
   - 从“强推覆盖”演进到“可选合并策略 + 人工确认”。
   - 增加冲突可视化与版本浏览 UI。

