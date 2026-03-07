# 文档块评论功能 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改动文档 JSON 本体的前提下，为文档块提供可持久化的多线程评论（创建线程、回复、解决/重开、删除），并在文档页提供右侧评论侧栏完成协作闭环。

**Architecture:** 后端在 `app-backend` 新增独立评论存储域（线程表 + 消息表），路由挂载到 owner-scope 文档路径下，并复用现有 project scope 权限体系。前端在 `DocumentPage` 增加“块评论上下文状态 + 评论侧栏”，由 `doc-editor` 块操作菜单触发，切换页签时恢复评论侧栏定位。文档锁定仅限制正文写入，评论接口不经过 `assertDocumentUnlocked`。

**Tech Stack:** TypeScript, Express, PostgreSQL, React, TipTap, Node test runner (`node --import tsx --test`), Playwright CLI

---

实施时请全程遵循：@superpowers:test-driven-development、@superpowers:verification-before-completion。  
前端改动回归必须执行：@playwright（账号读取 `output/playwright/test-account.json`）。

### Task 1: 补齐评论表结构与 DDL 快照

**Files:**
- Modify: `apps/app-backend/tests/ddl-init-snapshots.test.ts`
- Modify: `ddl/migrations/server.postgres/20260301-001-v1.0.0/up.sql`
- Modify: `ddl/migrations/server.postgres/20260301-001-v1.0.0/down.sql`
- Modify: `ddl/sql/init.server.postgres.sql`
- Modify: `ddl/sql/init.sql`
- Modify: `deploy/helm/charts/charts/postgres/files/init.sql`

**Step 1: Write the failing test**

在 `apps/app-backend/tests/ddl-init-snapshots.test.ts` 追加断言：

```ts
assert.match(serverMigrationUp, /CREATE TABLE IF NOT EXISTS document_block_comment_threads/i);
assert.match(serverMigrationUp, /CREATE TABLE IF NOT EXISTS document_block_comment_messages/i);
assert.match(serverInit, /document_block_comment_threads/i);
assert.match(compatInit, /document_block_comment_messages/i);
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/ddl-init-snapshots.test.ts`  
Expected: FAIL（缺少评论表 DDL）

**Step 3: Write minimal implementation**

在上面 5 个 SQL 文件中补齐相同结构（以 `up.sql` 为源）：

```sql
CREATE TABLE IF NOT EXISTS document_block_comment_threads (
  id          TEXT PRIMARY KEY,
  owner_type  TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  project_key TEXT NOT NULL,
  doc_id      TEXT NOT NULL,
  block_id    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_by  TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_block_comment_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES document_block_comment_threads(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_doc_block_comment_threads_scope_doc_status_updated
  ON document_block_comment_threads (owner_type, owner_id, project_key, doc_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_block_comment_threads_scope_doc_block_updated
  ON document_block_comment_threads (owner_type, owner_id, project_key, doc_id, block_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_block_comment_messages_thread_created
  ON document_block_comment_messages (thread_id, created_at ASC);
```

`down.sql` 增加反向清理：

```sql
DROP TABLE IF EXISTS document_block_comment_messages;
DROP TABLE IF EXISTS document_block_comment_threads;
```

**Step 4: Run test to verify it passes**

Run:
- `node --import tsx --test apps/app-backend/tests/ddl-init-snapshots.test.ts`
- `node --import tsx --test apps/app-backend/tests/ddl-migrations-consolidation.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/tests/ddl-init-snapshots.test.ts ddl/migrations/server.postgres/20260301-001-v1.0.0/up.sql ddl/migrations/server.postgres/20260301-001-v1.0.0/down.sql ddl/sql/init.server.postgres.sql ddl/sql/init.sql deploy/helm/charts/charts/postgres/files/init.sql
git commit -m "feat(db): add document block comments tables"
```

### Task 2: 实现评论域模型与权限判定

**Files:**
- Create: `apps/app-backend/src/services/document-block-comment-model.ts`
- Create: `apps/app-backend/tests/document-block-comment-permission.test.ts`

**Step 1: Write the failing test**

`apps/app-backend/tests/document-block-comment-permission.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMENT_THREAD_STATUSES,
  canDeleteCommentMessage,
  normalizeCommentThreadStatus,
} from "../src/services/document-block-comment-model.ts";

test("normalizeCommentThreadStatus only accepts open/resolved", () => {
  assert.equal(COMMENT_THREAD_STATUSES.has("open"), true);
  assert.equal(COMMENT_THREAD_STATUSES.has("resolved"), true);
  assert.equal(normalizeCommentThreadStatus("open"), "open");
  assert.equal(normalizeCommentThreadStatus("resolved"), "resolved");
  assert.equal(normalizeCommentThreadStatus("closed"), null);
});

test("message delete permission allows author and owner/admin", () => {
  assert.equal(canDeleteCommentMessage({ actorId: "u1", authorId: "u1", role: "member" }), true);
  assert.equal(canDeleteCommentMessage({ actorId: "u2", authorId: "u1", role: "admin" }), true);
  assert.equal(canDeleteCommentMessage({ actorId: "u2", authorId: "u1", role: "owner" }), true);
  assert.equal(canDeleteCommentMessage({ actorId: "u2", authorId: "u1", role: "member" }), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-block-comment-permission.test.ts`  
Expected: FAIL（模块不存在）

**Step 3: Write minimal implementation**

`apps/app-backend/src/services/document-block-comment-model.ts`：

```ts
export const COMMENT_THREAD_STATUSES = new Set(["open", "resolved"] as const);
export type CommentThreadStatus = "open" | "resolved";
export type ProjectRole = "owner" | "admin" | "member" | "viewer" | string;

export function normalizeCommentThreadStatus(input: unknown): CommentThreadStatus | null {
  const value = String(input ?? "").trim();
  if (value === "open" || value === "resolved") return value;
  return null;
}

export function canWriteComment(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canDeleteCommentMessage(input: { actorId: string; authorId: string; role: ProjectRole }): boolean {
  const actor = input.actorId.trim();
  const author = input.authorId.trim();
  if (!actor || !author) return false;
  if (actor === author) return true;
  return input.role === "owner" || input.role === "admin";
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-block-comment-permission.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-block-comment-model.ts apps/app-backend/tests/document-block-comment-permission.test.ts
git commit -m "test(app-backend): add block comment permission model"
```

### Task 3: 实现评论存储服务（线程/消息 CRUD + scope 隔离）

**Files:**
- Create: `apps/app-backend/src/services/document-block-comment-store.ts`
- Create: `apps/app-backend/tests/document-block-comment-store.test.ts`

**Step 1: Write the failing test**

`apps/app-backend/tests/document-block-comment-store.test.ts`（参考 `message-center-store.test.ts` 风格）：

```ts
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closePool, query } from "../src/db/postgres.ts";
import { documentBlockCommentStore } from "../src/services/document-block-comment-store.ts";

test("create thread and append message under scoped project", async (t) => {
  // canConnect + skip
  const created = await documentBlockCommentStore.createThread({
    userId: "u-a",
    projectKey: "personal::u-a::p1",
    docId: "d1",
    blockId: "b1",
    content: "first",
  });
  assert.equal(created.thread.docId, "d1");
  assert.equal(created.messages.length, 1);

  const next = await documentBlockCommentStore.addMessage({
    userId: "u-a",
    projectKey: "personal::u-a::p1",
    docId: "d1",
    threadId: created.thread.id,
    content: "reply",
  });
  assert.equal(next.id.length > 0, true);
});

after(async () => closePool());
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-block-comment-store.test.ts`  
Expected: FAIL（store 不存在）

**Step 3: Write minimal implementation**

在 `document-block-comment-store.ts` 实现：

```ts
export const documentBlockCommentStore = {
  async createThread(input) { /* resolveProjectScope + insert thread + first message + return detail */ },
  async listThreads(input) { /* docId + blockId/status 过滤 + cursor/limit */ },
  async getThread(input) { /* thread belongs scope+doc */ },
  async addMessage(input) { /* insert message + touch thread updated_at */ },
  async setThreadStatus(input) { /* status open/resolved + resolved_by/resolved_at */ },
  async deleteMessage(input) { /* soft delete or hard delete by id and scope */ },
};
```

包含：
- `ensureInitialized()`：`CREATE TABLE IF NOT EXISTS` 容错（与 DDL 一致）
- 自定义错误：`CommentThreadNotFoundError`、`CommentMessageNotFoundError`
- 所有查询条件必须带 `(owner_type, owner_id, project_key, doc_id)`

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-block-comment-store.test.ts`  
Expected: PASS（若本机无 Postgres 则 SKIP）

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-block-comment-store.ts apps/app-backend/tests/document-block-comment-store.test.ts
git commit -m "feat(app-backend): add document block comment store"
```

### Task 4: 挂载评论 API 路由并接入文档/块校验

**Files:**
- Create: `apps/app-backend/src/services/document-block-comment-http.ts`
- Modify: `apps/app-backend/src/router.ts`
- Create: `apps/app-backend/tests/document-block-comment-http.test.ts`

**Step 1: Write the failing test**

`apps/app-backend/tests/document-block-comment-http.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseCommentListQuery, parseCommentStatusInput } from "../src/services/document-block-comment-http.ts";

test("parseCommentListQuery accepts blockId/status/limit", () => {
  const parsed = parseCommentListQuery({ blockId: "b1", status: "open", limit: "20" });
  assert.equal(parsed.blockId, "b1");
  assert.equal(parsed.status, "open");
  assert.equal(parsed.limit, 20);
});

test("parseCommentStatusInput rejects unsupported status", () => {
  assert.equal(parseCommentStatusInput({ status: "closed" }), null);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-block-comment-http.test.ts`  
Expected: FAIL（模块不存在）

**Step 3: Write minimal implementation**

在 `router.ts` 新增并接入以下路由（owner-scope 前缀保持一致）：

```ts
GET    /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments
GET    /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId
POST   /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments
POST   /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId/messages
PATCH  /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId
DELETE /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/messages/:messageId
```

路由内业务规则：
- 创建线程前调用 `documentStore.getBlockById(userId, projectKey, docId, blockId)` 校验块存在
- 回复/状态变更前校验线程归属当前 scope + doc
- 删除消息时执行“作者或 admin/owner”权限判定
- 不调用 `loadUnlockedDocument` 或 `assertDocumentUnlocked`，保证锁文档下可评论

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test apps/app-backend/tests/document-block-comment-http.test.ts`
- `node --import tsx --test apps/app-backend/tests/document-block-comment-permission.test.ts`
- `node --import tsx --test apps/app-backend/tests/document-block-comment-store.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-block-comment-http.ts apps/app-backend/src/router.ts apps/app-backend/tests/document-block-comment-http.test.ts
git commit -m "feat(app-backend): expose scoped block comments api routes"
```

### Task 5: 增加前端评论 API 客户端与类型映射

**Files:**
- Modify: `apps/web/src/api/documents.ts`
- Create: `apps/web/tests/document-block-comment-api.test.ts`

**Step 1: Write the failing test**

`apps/web/tests/document-block-comment-api.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlockCommentThreadsPath,
  mapDocumentBlockCommentThread,
} from "../src/api/documents";

test("buildBlockCommentThreadsPath uses scoped route and query", () => {
  const path = buildBlockCommentThreadsPath("personal::me::p1", "d1", {
    blockId: "b1",
    status: "open",
    limit: 20,
  });
  assert.equal(path, "/api/projects/personal/me/p1/documents/d1/block-comments?blockId=b1&status=open&limit=20");
});

test("mapDocumentBlockCommentThread normalizes nested messages", () => {
  const mapped = mapDocumentBlockCommentThread({
    id: "t1",
    blockId: "b1",
    status: "open",
    messages: [{ id: "m1", content: "hello", authorId: "u1" }],
  });
  assert.equal(mapped.id, "t1");
  assert.equal(mapped.messages.length, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-block-comment-api.test.ts`  
Expected: FAIL（函数未实现）

**Step 3: Write minimal implementation**

在 `apps/web/src/api/documents.ts` 添加：

```ts
export type DocumentBlockCommentStatus = "open" | "resolved";
export type DocumentBlockCommentMessage = { id: string; threadId: string; authorId: string; content: string; createdAt: string; updatedAt: string };
export type DocumentBlockCommentThread = { id: string; docId: string; blockId: string; status: DocumentBlockCommentStatus; createdBy: string; createdAt: string; updatedAt: string; resolvedBy?: string; resolvedAt?: string; messages: DocumentBlockCommentMessage[] };

export function buildBlockCommentThreadsPath(projectKey: string, docId: string, input?: { blockId?: string; status?: DocumentBlockCommentStatus; cursor?: string; limit?: number }): string;
export function mapDocumentBlockCommentThread(raw: unknown): DocumentBlockCommentThread;
export async function fetchDocumentBlockCommentThreads(...): Promise<{ items: DocumentBlockCommentThread[]; nextCursor?: string }>;
export async function fetchDocumentBlockCommentThread(...): Promise<DocumentBlockCommentThread>;
export async function createDocumentBlockCommentThread(...): Promise<DocumentBlockCommentThread>;
export async function createDocumentBlockCommentMessage(...): Promise<DocumentBlockCommentMessage>;
export async function updateDocumentBlockCommentThreadStatus(...): Promise<DocumentBlockCommentThread>;
export async function deleteDocumentBlockCommentMessage(...): Promise<void>;
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-block-comment-api.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/api/documents.ts apps/web/tests/document-block-comment-api.test.ts
git commit -m "feat(web): add document block comment api client"
```

### Task 6: 建立评论前端状态模型（按 docId/blockId 恢复上下文）

**Files:**
- Create: `apps/web/src/features/document-page/block-comment-state.ts`
- Create: `apps/web/tests/document-block-comment-state.test.ts`

**Step 1: Write the failing test**

`apps/web/tests/document-block-comment-state.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  createBlockCommentState,
  reduceBlockCommentState,
} from "../src/features/document-page/block-comment-state";

test("open panel stores active block context per doc", () => {
  let state = createBlockCommentState();
  state = reduceBlockCommentState(state, { type: "open-panel", docId: "d1", blockId: "b1" });
  state = reduceBlockCommentState(state, { type: "open-panel", docId: "d2", blockId: "b2" });
  assert.equal(state.panelByDocId["d1"]?.blockId, "b1");
  assert.equal(state.panelByDocId["d2"]?.blockId, "b2");
});

test("upsert thread updates per-block count", () => {
  let state = createBlockCommentState();
  state = reduceBlockCommentState(state, { type: "upsert-thread", docId: "d1", blockId: "b1", threadId: "t1" });
  assert.equal(state.countByDocId["d1"]?.["b1"], 1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-block-comment-state.test.ts`  
Expected: FAIL（模块不存在）

**Step 3: Write minimal implementation**

`apps/web/src/features/document-page/block-comment-state.ts`：

```ts
export type BlockCommentPanelState = { visible: boolean; blockId: string | null; threadId: string | null };
export type BlockCommentState = {
  panelByDocId: Record<string, BlockCommentPanelState>;
  countByDocId: Record<string, Record<string, number>>;
};

export function createBlockCommentState(): BlockCommentState {
  return { panelByDocId: {}, countByDocId: {} };
}

export function reduceBlockCommentState(state: BlockCommentState, event: any): BlockCommentState {
  // open-panel / close-panel / upsert-thread / remove-thread / hydrate-counts
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-block-comment-state.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/features/document-page/block-comment-state.ts apps/web/tests/document-block-comment-state.test.ts
git commit -m "feat(web): add block comment page state reducer"
```

### Task 7: 在编辑器块菜单增加“评论”入口并向页面抛出 blockId

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.scss`
- Modify: `packages/doc-editor/src/index.ts`
- Modify: `apps/web/src/components/RichTextEditor.tsx`
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`
- Create: `packages/doc-editor/tests/block-comment-action.test.ts`
- Modify: `package.json`（`test:unified-editor` 加入新测试）

**Step 1: Write the failing test**

`packages/doc-editor/tests/block-comment-action.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveBlockCommentCount } from "../src/templates/simple/doc-editor";

test("resolveBlockCommentCount returns zero for missing block", () => {
  assert.equal(resolveBlockCommentCount("b1", {}), 0);
  assert.equal(resolveBlockCommentCount("b1", { b1: 2 }), 2);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-comment-action.test.ts`  
Expected: FAIL（函数不存在）

**Step 3: Write minimal implementation**

在编辑器中新增 props 并接入块菜单：

```ts
type DocEditorProps = {
  onBlockCommentOpen?: (input: { blockId: string }) => void;
  commentCountByBlockId?: Record<string, number>;
};

export function resolveBlockCommentCount(blockId: string, counts?: Record<string, number>): number {
  const key = String(blockId || "").trim();
  if (!key) return 0;
  const value = Number(counts?.[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
```

块菜单新增按钮：

```tsx
<button
  className="doc-editor-block-action-menu-item"
  type="button"
  role="menuitem"
  onClick={() => {
    if (currentBlockId) onBlockCommentOpen?.({ blockId: currentBlockId });
    setBlockActionMenuOpen(false);
  }}
>
  评论{currentCommentCount > 0 ? `（${currentCommentCount}）` : ""}
</button>
```

并在 `RichTextEditor` / `DocumentWorkspace` 透传 `onBlockCommentOpen`、`commentCountByBlockId`。

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test packages/doc-editor/tests/block-comment-action.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add package.json packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/templates/simple/doc-editor.scss packages/doc-editor/src/index.ts packages/doc-editor/tests/block-comment-action.test.ts apps/web/src/components/RichTextEditor.tsx apps/web/src/components/DocumentWorkspace.tsx
git commit -m "feat(doc-editor): add block comment action entry"
```

### Task 8: 实现文档页评论侧栏与线程交互

**Files:**
- Create: `apps/web/src/components/DocumentBlockCommentSidebar.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/App.css`
- Create: `apps/web/tests/document-page-comment-context.test.ts`

**Step 1: Write the failing test**

`apps/web/tests/document-page-comment-context.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createBlockCommentState, reduceBlockCommentState } from "../src/features/document-page/block-comment-state";

test("tab switch restores panel context for each document", () => {
  let state = createBlockCommentState();
  state = reduceBlockCommentState(state, { type: "open-panel", docId: "doc-a", blockId: "ba" });
  state = reduceBlockCommentState(state, { type: "open-panel", docId: "doc-b", blockId: "bb" });
  assert.equal(state.panelByDocId["doc-a"]?.blockId, "ba");
  assert.equal(state.panelByDocId["doc-b"]?.blockId, "bb");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-page-comment-context.test.ts`  
Expected: FAIL（状态流未接入 DocumentPage）

**Step 3: Write minimal implementation**

在 `DocumentPage.tsx` 接入：

```tsx
const [commentState, setCommentState] = useState(() => createBlockCommentState());
const activeCommentPanel = commentState.panelByDocId[activeDocument?.id ?? ""] ?? { visible: false, blockId: null, threadId: null };

const handleOpenBlockComment = useCallback(({ blockId }: { blockId: string }) => {
  if (!activeDocument?.id) return;
  setCommentState((prev) => reduceBlockCommentState(prev, { type: "open-panel", docId: activeDocument.id, blockId }));
}, [activeDocument?.id]);
```

新增评论侧栏组件职责：
- 顶部显示块摘要（blockId + 文本片段）
- 展示线程列表 / 消息列表
- 支持新建线程、回复、解决/重开、删除消息
- 首次打开块时拉取 `fetchDocumentBlockCommentThreads(projectKey, docId, { blockId })`
- 操作成功后局部刷新状态，不触发整页 reload

`App.css` 增加评论侧栏样式（与现有右侧 LLM 栏并存，边框和背景遵循当前变量）。

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test apps/web/tests/document-page-comment-context.test.ts`
- `node --import tsx --test apps/web/tests/document-block-comment-state.test.ts`
- `node --import tsx --test apps/web/tests/document-block-comment-api.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentBlockCommentSidebar.tsx apps/web/src/pages/DocumentPage.tsx apps/web/src/App.css apps/web/tests/document-page-comment-context.test.ts
git commit -m "feat(web): add document block comments sidebar workflow"
```

### Task 9: 回归测试（含“锁定文档仍可评论”）

**Files:**
- Create: `output/playwright/document-block-comments-regression.js`
- Create: `output/playwright/document-block-comments-regression.md`

**Step 1: Write the failing test**

先写脚本骨架并执行一次（预期失败）：

```js
// output/playwright/document-block-comments-regression.js
// 读取 output/playwright/test-account.json 登录
// 打开文档 -> 触发块菜单“评论” -> 创建线程 -> 回复 -> 解决 -> 重开 -> 删除消息
// 锁定文档后再次评论，验证评论成功且正文仍只读
```

**Step 2: Run test to verify it fails**

Run:
`/bin/zsh -lc 'playwright-cli run-code "$(cat /Users/darin/mine/code/zeus/output/playwright/document-block-comments-regression.js)"'`  
Expected: FAIL（脚本未完成或断言失败）

**Step 3: Write minimal implementation**

完善脚本关键断言：

```js
await expect(page.getByText("评论")).toBeVisible();
await expect(page.getByText("已解决")).toBeVisible();
await expect(page.getByText("已重新打开")).toBeVisible();
await expect(page.getByText("文档已锁定")).toBeVisible();
await expect(page.getByText("评论发送成功")).toBeVisible();
```

并写入 `output/playwright/document-block-comments-regression.md`：记录运行命令、账号来源、结果摘要、失败截图路径（若失败）。

**Step 4: Run test to verify it passes**

Run:
`/bin/zsh -lc 'playwright-cli run-code "$(cat /Users/darin/mine/code/zeus/output/playwright/document-block-comments-regression.js)"'`  
Expected: PASS，并更新报告文件。

**Step 5: Commit**

```bash
git add output/playwright/document-block-comments-regression.js output/playwright/document-block-comments-regression.md
git commit -m "test(web): add playwright regression for block comments"
```

### Task 10: 端到端验收与收尾

**Files:**
- Modify: `docs/plans/2026-03-04-document-block-comments-implementation.md`（补齐执行记录，可选）

**Step 1: Write the failing test**

把最终验收命令整理成一次完整执行清单（先跑一次，记录失败点）：

```bash
node --import tsx --test apps/app-backend/tests/document-block-comment-permission.test.ts
node --import tsx --test apps/app-backend/tests/document-block-comment-http.test.ts
node --import tsx --test apps/app-backend/tests/document-block-comment-store.test.ts
node --import tsx --test apps/web/tests/document-block-comment-api.test.ts
node --import tsx --test apps/web/tests/document-block-comment-state.test.ts
node --import tsx --test apps/web/tests/document-page-comment-context.test.ts
npm run test:unified-editor
/bin/zsh -lc 'playwright-cli run-code "$(cat /Users/darin/mine/code/zeus/output/playwright/document-block-comments-regression.js)"'
```

**Step 2: Run test to verify it fails**

Run: 上述命令  
Expected: 至少有一项 FAIL（在修正前）

**Step 3: Write minimal implementation**

修复最后剩余问题，确保：
- 评论接口全部走 owner-scope
- 文档锁定下评论可写，正文不可写
- 切换页签后评论侧栏恢复到各自 doc 上下文
- 空评论内容、非法状态、越权删除都返回明确错误码

**Step 4: Run test to verify it passes**

Run: 上述命令  
Expected: PASS（或 PostgreSQL 场景下相关测试 SKIP）

**Step 5: Commit**

```bash
git add apps/app-backend/src apps/app-backend/tests apps/web/src apps/web/tests packages/doc-editor/src packages/doc-editor/tests output/playwright
git commit -m "feat: deliver document block comments end-to-end"
```
