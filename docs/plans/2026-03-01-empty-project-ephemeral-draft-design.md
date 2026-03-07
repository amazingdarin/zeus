# 空项目自动草稿文档与首改落库设计（Design）

## 背景
当前存在一个首登场景问题：新账号登录后可能进入 `/documents/:documentId`，但该 `documentId` 在当前项目中并不存在，导致页面出现 `failed to load document`。

用户期望行为：
1. 只要项目里没有任何文档，自动进入“无标题文档”。
2. 初始状态不落库，保持草稿态。
3. 用户开始修改后，才自动创建并保存真实文档。

## 目标
1. 当项目文档数为 0 时，自动展示“无标题文档”编辑态，不报错。
2. 在用户无任何有效修改前，不调用后端创建或更新接口。
3. 首次有效修改时自动创建文档并切换到真实 `docId`。
4. 创建成功后接入现有自动保存链路（`saveScheduler + updateDocumentContent`）。

## 非目标
1. 不做跨刷新恢复未落库草稿。
2. 不在后端引入“未编辑草稿占位文档”实体。
3. 不修改现有文档同步、索引、收藏等后端协议。

## 已确认约束
1. 触发条件：仅当项目中“一个文档都没有”。
2. 路由兼容：即使 URL 带有无效 `documentId`，空项目时也进入草稿态。
3. 落库时机：仅首次有效编辑后。
4. 未编辑离开页面：不落库、无副作用。

## 方案对比

### 方案 A：登录后后端直接创建默认文档
优点：
1. 接入简单，前端改动少。

缺点：
1. 不满足“未编辑不保存”。
2. 可能产生大量无意义文档。

结论：不采用。

### 方案 B：前端临时草稿文档（推荐）
做法：
1. 前端在空项目下创建内存态 `ephemeral-draft`。
2. 首次有效编辑触发 `createDocument`。
3. 创建成功后替换为真实文档并继续自动保存。

优点：
1. 完整满足“未编辑不落库”。
2. 用户体验与现有编辑链路一致。

缺点：
1. 需要在 `DocumentPage`、`DocumentWorkspace`、tab/snapshot 管理增加草稿状态机。

### 方案 C：后端草稿占位实体
优点：
1. 草稿可跨端恢复。

缺点：
1. 本质仍需落库，不符合“未编辑不保存”语义。
2. 后端复杂度和维护成本增加。

结论：不采用。

## 推荐架构

### 1) 工作区模式状态机
在 `DocumentPage` 引入两种模式：
1. `persisted`：真实文档模式（现有逻辑）。
2. `ephemeral-draft`：未落库草稿模式（新增）。

模式切换规则：
1. `documents/tree` 为空 -> `ephemeral-draft`。
2. `documents/tree` 非空 -> `persisted`。
3. 草稿首次有效编辑创建成功 -> `persisted`。

### 2) 草稿文档模型（前端内存）
建议统一使用固定虚拟 ID：

```ts
type EphemeralDraftDoc = {
  id: "__ephemeral_draft__";
  title: "无标题文档";
  content: JSONContent; // 初始 EMPTY_DOC
  dirty: boolean;       // 首次有效编辑前为 false
  createdAt: number;
};
```

该对象只存在于前端内存态，不进入后端接口。

### 3) 首改落库门控
`DocumentWorkspace` 增加持久化门控能力：
1. `persistMode = "ephemeral"` 时，禁止 `updateDocumentContent` 调用。
2. 对标题/正文变更执行“有效编辑判断”：
   - 标题仍为默认且正文为空 -> 无效变更。
   - 否则为首次有效变更。
3. 首次有效变更时回调 `onFirstMeaningfulChange(payload)`。

`DocumentPage` 收到回调后执行：
1. 调用 `createDocument` 创建真实文档。
2. 用真实 `docId` 替换虚拟草稿 ID：
   - 更新路由 `/documents/:docId`
   - 更新 tab/snapshot/documentsById/breadcrumb/tree
3. 切换 `persistMode` 为 `persisted`，继续走现有自动保存。

## 关键流程

### 流程 1：空项目首次进入
1. 载入项目后请求 `documents/tree`。
2. 结果为空 -> 创建内存草稿并展示“无标题文档”。
3. 不触发任何保存请求。

### 流程 2：首改创建
1. 用户修改标题或正文。
2. 判断为首次有效编辑。
3. 调用 `createDocument`，成功后替换为真实文档并继续自动保存。

### 流程 3：空项目 + URL 带失效 docId
1. 进入 `/documents/:invalidId`。
2. 树为空 -> 强制回到草稿模式（可 `replace` 到 `/documents`）。
3. 页面不再显示 `failed to load document`。

## 异常处理
1. `createDocument` 失败：
   - 仍停留草稿态，保留用户输入。
   - UI 显示“首次保存失败，请重试”。
   - 提供“立即重试”动作。
2. 并发首改：
   - 使用 `creatingRef` 锁，仅允许一次创建请求。
3. 项目切换/登出：
   - 丢弃未落库草稿，避免错误迁移到其他项目。

## 对现有能力的影响边界
1. 草稿模式下不写入：
   - recent-edits
   - favorites
   - sync/rag rebuild
2. 创建成功后恢复现有行为。

## 测试设计

### 单元测试
1. 有效编辑判断函数：
   - 默认标题 + 空正文 => false
   - 标题变更或正文变更 => true
2. 草稿模式门控：
   - 未首改不调 `updateDocumentContent`
   - 首改后先 `createDocument` 再进入保存链路

### 组件/集成测试
1. 空树进入草稿模式。
2. 空树 + 失效 `documentId` 不报错，显示草稿。
3. 首改后路由切换到真实 `docId`，tab/tree/breadcrumb 同步更新。

### Playwright CLI 回归
1. 使用固定账号文件：`output/playwright/test-account.json`。
2. 场景覆盖：
   - 新账号首次进入：显示草稿且后端无文档新增。
   - 输入一个字符后：自动创建真实文档。
   - 刷新后：可打开刚创建文档，且不再是草稿模式。

## 验收标准
1. 空项目进入文档页时，始终可编辑“无标题文档”，不出现加载失败。
2. 用户未做有效修改前，后端无新文档记录。
3. 首次有效修改后，自动创建真实文档并继续自动保存。
4. 失效路由在空项目下可自动恢复到可用编辑状态。
