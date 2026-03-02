# 文档锁定功能设计

日期：2026-03-02  
状态：已评审确认

## 1. 目标与范围

目标：为文档提供“锁定后只读”的能力。被锁定文档不允许编辑，只能查看。

范围约束（已确认）：
- 锁定后，禁止当前文档的所有写操作。
- 不禁止其他文档写操作，包括：
  - 在该文档下创建子文档
  - 导入生成子文档
  - 基于该文档创建副本
  - 编辑其他文档

权限规则（已确认）：
- 任何对当前文档有写权限的用户都可以锁定/解锁。

并发场景策略（已确认）：
- 若用户正在编辑时被他人锁定，则在“下一次保存”时返回失败，并切换为只读。

## 2. 方案对比与决策

### 方案 A：文档 `meta.extra` 内嵌锁信息（推荐）
- 在文档元数据 `meta.extra.lock` 中记录锁状态。
- 后端在“写当前 docId”接口统一校验锁。
- 前端根据文档详情中的锁状态控制 UI 与编辑行为。

优点：
- 落地快，改造面可控。
- 无需新增数据库表与迁移。
- 与现有文档读取流程天然兼容。

缺点：
- 列表态若要聚合锁信息，需要额外在树接口补字段或读取详情。

### 方案 B：独立 `document_locks` 表
优点：查询效率和并发语义更清晰；后续可扩展租约机制。  
缺点：新增 migration 与更多跨层改造，首版成本更高。

### 方案 C：文件 sidecar 锁文件
优点：不改 schema。  
缺点：跨实例一致性弱，不适合当前架构。

决策：首版采用 **方案 A**。

## 3. 锁模型

锁字段定义（存于 `meta.extra.lock`）：

```json
{
  "locked": true,
  "lockedBy": "<userId>",
  "lockedAt": "<ISO-8601>"
}
```

约定：
- 锁定：写入上述结构。
- 解锁：移除 `meta.extra.lock`（推荐），避免 `locked=false` 残留歧义。

## 4. 后端设计

### 4.1 新增 API
- `PUT /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/lock`
- `DELETE /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/lock`

返回：文档最新 `meta.extra.lock` 状态。

### 4.2 统一锁校验
新增统一校验函数（示意）：
- `assertDocumentUnlocked(userId, projectKey, docId)`

行为：
- 若文档被锁定，返回：
  - HTTP `423 Locked`
  - `code: "DOCUMENT_LOCKED"`
  - message + lock 信息（`lockedBy`、`lockedAt`）

### 4.3 受锁保护的写接口（首批）
- `PUT /documents/:docId`（标题/正文保存）
- `PATCH /documents/:docId/blocks/:blockId`
- `PATCH /documents/:docId/move`
- `DELETE /documents/:docId`
- 任何对该文档的优化结果写回路径（如 optimize apply）
- 提案应用写回路径（如 apply proposal）

### 4.4 不受锁限制接口
- `POST /documents`（创建子文档）
- 导入相关接口（最终创建的是新文档）
- `POST /documents/:docId/duplicate`（创建副本）
- 导出与只读查询接口

## 5. 前端设计

### 5.1 展示与交互
在文档页头部增加锁定状态与操作：
- 状态：`已锁定 / 未锁定`
- 操作：`锁定 / 解锁`

锁定态 UI：
- 标题输入框 `readOnly`
- 编辑器切换为只读（`mode="view"` 或 `editable=false`）
- 显示提示：“该文档已锁定，仅可查看”

### 5.2 操作可用性规则
锁定时禁用/隐藏仅针对当前文档本体写操作：
- 保存、标题修改、正文编辑
- 删除当前文档
- 移动当前文档
- 优化写回
- 提案应用

锁定时保留可用：
- 新建子文档
- 导入
- 创建副本
- 导出

### 5.3 编辑中被锁定（按确认策略）
当自动保存或手动保存返回 `423 DOCUMENT_LOCKED`：
1. 终止后续保存调度
2. 将当前工作区切换为只读
3. toast 提示“文档已被锁定，已切换为只读”
4. 保留当前界面内容（不再尝试写回）

### 5.4 标签页与缓存
- 文档 tab/snapshot 结构增加 `locked` 显式状态，切换页签时保持一致只读体验。

## 6. 错误码与兼容性

新增错误码：
- `DOCUMENT_LOCKED`（HTTP 423）

兼容性：
- 历史文档没有 `meta.extra.lock` 字段时，视为未锁定。
- 现有接口响应结构保持兼容，新增字段仅在 `extra` 内扩展。

## 7. 测试与验收

### 7.1 后端
- 锁定/解锁 API：正常与幂等场景
- 写接口锁校验：锁定时返回 `423 DOCUMENT_LOCKED`
- 白名单操作验证：创建子文档、导入、创建副本在父文档锁定时仍成功

### 7.2 前端
- 锁定态渲染（标题只读、编辑器只读、按钮状态正确）
- 保存返回 423 后转只读与提示
- Tab 切换后锁态保持

### 7.3 Playwright 回归
- 锁定后无法编辑当前文档
- 可创建并编辑子文档
- 其他文档写操作不受影响
- 编辑中触发锁定后，首次保存失败切只读

## 8. 非目标（首版不做）

- 锁自动过期/租约续约
- 细粒度块级锁
- 强制接管锁与复杂审计面板
