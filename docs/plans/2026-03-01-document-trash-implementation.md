# 文档垃圾箱 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将文档删除改为“移入垃圾箱”，并提供恢复、彻底删除、清空、自动清理能力，覆盖后端、前端与测试。

**Architecture:** 后端采用项目作用域下的文件系统垃圾箱（`docs/.trash`）与索引文件（`index.json`）管理软删除记录；文档删除 API 改为入箱语义，新增垃圾箱专属 API。前端在文档侧边栏提供垃圾箱入口与操作面板，并在通用设置中增加自动清理配置；全链路通过单元测试与 Playwright 回归保障稳定性。

**Tech Stack:** TypeScript, Node.js fs/promises, Express, React, Ant Design, Node test runner (`node --import tsx --test`), playwright-cli

---

实施时请全程遵循：@superpowers:test-driven-development、@superpowers:verification-before-completion、@playwright。

### Task 1: 实现后端垃圾箱存储层（文件移动 + 索引）

**Files:**
- Create: `apps/app-backend/src/services/document-trash/store.ts`
- Create: `apps/app-backend/src/services/document-trash/types.ts`
- Create: `apps/app-backend/tests/document-trash-store.test.ts`
- Modify: `apps/app-backend/src/storage/document-store.ts`（复用后代收集能力）

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocumentTrashStore } from "../src/services/document-trash/store.ts";

test("trash-store: move directory document into single trash entry", async () => {
  const store = createDocumentTrashStore();
  const moved = await store.moveToTrash({
    userId: "u1",
    projectKey: "personal::u1::p1",
    docId: "dir-doc",
    recursive: true,
  });
  assert.equal(moved.entry.entityType, "directory");
  assert.equal(moved.deletedIds.includes("dir-doc"), true);
  assert.equal(moved.deletedIds.includes("child-a"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts`
Expected: FAIL（`createDocumentTrashStore` 或 `moveToTrash` 尚未实现）

**Step 3: Write minimal implementation**

```ts
export function createDocumentTrashStore() {
  return {
    async moveToTrash(input) {
      const deletedIds = await documentStore.collectDeleteSet(input.userId, input.projectKey, input.docId, input.recursive);
      const entry = await writeTrashEntryAndIndex(input, deletedIds);
      await moveDocPayloadToTrashDir(input, entry.trashId);
      return { entry, deletedIds };
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-trash/types.ts apps/app-backend/src/services/document-trash/store.ts apps/app-backend/src/storage/document-store.ts apps/app-backend/tests/document-trash-store.test.ts
git commit -m "feat: add filesystem-based document trash store"
```

### Task 2: 将文档删除路由切换为“移入垃圾箱”

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/app-backend/src/services/document-trash/store.ts`
- Test: `apps/app-backend/tests/document-trash-store.test.ts`

**Step 1: Write the failing test**

```ts
test("delete route contract returns moved deleted_ids instead of hard delete", async () => {
  // arrange: 文档 + 子文档
  // act: 调用 trashStore.moveToTrash
  // assert: 返回 deleted_ids 包含子树 id
  assert.equal(false, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
router.delete("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId", async (req, res) => {
  const result = await documentTrashStore.moveToTrash({ userId, projectKey, docId: nextDocId, recursive: nextRecursive });
  await documentFavoriteStore.removeMany(userId, projectKey, result.deletedIds);
  await Promise.all(result.deletedIds.map((id) => knowledgeSearch.removeDocument(userId, projectKey, id)));
  success(res, { deleted_ids: result.deletedIds, count: result.deletedIds.length, trash_id: result.entry.trashId });
});
```

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/src/services/document-trash/store.ts apps/app-backend/tests/document-trash-store.test.ts
git commit -m "feat: switch document delete to move-to-trash semantics"
```

### Task 3: 新增垃圾箱 API（列表/恢复/单删/清空）

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/app-backend/src/services/document-trash/store.ts`
- Create: `apps/app-backend/tests/document-trash-api-contract.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocumentTrashStore } from "../src/services/document-trash/store.ts";

test("trash-store: restore resolves missing parent and naming conflicts", async () => {
  const store = createDocumentTrashStore();
  const restored = await store.restore({ userId: "u1", projectKey: "personal::u1::p1", trashId: "t1" });
  assert.equal(restored.fallbackToRoot, true);
  assert.match(restored.finalTitle, /恢复/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-api-contract.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
router.get("/projects/:ownerType/:ownerKey/:projectKey/trash", async (req, res) => {
  const items = await documentTrashStore.list({ userId, projectKey });
  success(res, items);
});
router.post("/projects/:ownerType/:ownerKey/:projectKey/trash/:trashId/restore", async (req, res) => {
  const restored = await documentTrashStore.restore({ userId, projectKey, trashId: req.params.trashId });
  success(res, restored);
});
router.delete("/projects/:ownerType/:ownerKey/:projectKey/trash/:trashId", async (req, res) => {
  const purged = await documentTrashStore.purgeOne({ userId, projectKey, trashId: req.params.trashId });
  success(res, purged);
});
router.delete("/projects/:ownerType/:ownerKey/:projectKey/trash", async (req, res) => {
  const purged = await documentTrashStore.purgeAll({ userId, projectKey });
  success(res, purged);
});
```

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-api-contract.test.ts apps/app-backend/tests/document-trash-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/src/services/document-trash/store.ts apps/app-backend/tests/document-trash-api-contract.test.ts apps/app-backend/tests/document-trash-store.test.ts
git commit -m "feat: add project-scoped trash api endpoints"
```

### Task 4: 扩展通用配置与数据库字段（自动清理开关 + 天数）

**Files:**
- Modify: `apps/app-backend/src/services/general-settings-store.ts`
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/app-backend/tests/general-settings-store.test.ts`
- Modify: `apps/app-backend/tests/ddl-migrations-consolidation.test.ts`
- Modify: `ddl/sql/init.sql`
- Modify: `ddl/sql/init.server.postgres.sql`
- Modify: `ddl/sql/init.desktop.sqlite.sql`
- Modify: `ddl/sql/init.mobile.sqlite.sql`
- Modify: `ddl/migrations/server.postgres/20260301-001-v1.0.0/up.sql`
- Modify: `ddl/migrations/desktop.sqlite/20260301-001-v1.0.0/up.sql`
- Modify: `ddl/migrations/mobile.sqlite/20260301-001-v1.0.0/up.sql`

**Step 1: Write the failing test**

```ts
test("general-settings-store: persists trash auto cleanup fields", async () => {
  const store = createGeneralSettingsStore({ queryFn });
  await store.update("user-trash", {
    trashAutoCleanupEnabled: true,
    trashAutoCleanupDays: 30,
  });
  const loaded = await store.get("user-trash");
  assert.equal(loaded.trashAutoCleanupEnabled, true);
  assert.equal(loaded.trashAutoCleanupDays, 30);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/general-settings-store.test.ts apps/app-backend/tests/ddl-migrations-consolidation.test.ts`
Expected: FAIL（新字段未实现）

**Step 3: Write minimal implementation**

```ts
export type GeneralSettings = {
  useRemoteKnowledgeBase: boolean;
  documentAutoSync: boolean;
  documentBlockShortcuts: DocumentBlockShortcuts;
  trashAutoCleanupEnabled: boolean;
  trashAutoCleanupDays: number;
};

// update/read SQL 同步新增
// trash_auto_cleanup_enabled
// trash_auto_cleanup_days
```

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/app-backend/tests/general-settings-store.test.ts apps/app-backend/tests/ddl-migrations-consolidation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/general-settings-store.ts apps/app-backend/src/router.ts apps/app-backend/tests/general-settings-store.test.ts apps/app-backend/tests/ddl-migrations-consolidation.test.ts ddl/sql/init.sql ddl/sql/init.server.postgres.sql ddl/sql/init.desktop.sqlite.sql ddl/sql/init.mobile.sqlite.sql ddl/migrations/server.postgres/20260301-001-v1.0.0/up.sql ddl/migrations/desktop.sqlite/20260301-001-v1.0.0/up.sql ddl/migrations/mobile.sqlite/20260301-001-v1.0.0/up.sql
git commit -m "feat: add trash auto cleanup settings and schema fields"
```

### Task 5: 实现自动清理调度器并接入后端启动流程

**Files:**
- Create: `apps/app-backend/src/services/document-trash/scheduler.ts`
- Modify: `apps/app-backend/src/index.ts`
- Modify: `apps/app-backend/tests/document-trash-store.test.ts`

**Step 1: Write the failing test**

```ts
test("trash-scheduler: skips cleanup when disabled", async () => {
  const calls: string[] = [];
  const stop = startDocumentTrashCleanupScheduler({
    getSettings: async () => ({ trashAutoCleanupEnabled: false, trashAutoCleanupDays: 30 }),
    sweep: async () => { calls.push("sweep"); },
    intervalMs: 5,
  });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(calls.length, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export function startDocumentTrashCleanupScheduler(opts): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    const settings = await opts.getSettings();
    if (!settings.trashAutoCleanupEnabled) return;
    await opts.sweep(settings.trashAutoCleanupDays);
  };
  const timer = setInterval(() => void run(), opts.intervalMs ?? 60 * 60 * 1000);
  timer.unref?.();
  void run();
  return () => { stopped = true; clearInterval(timer); };
}
```

`index.ts` 中注册 stop 函数并在 `SIGINT/SIGTERM` 清理。

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-trash/scheduler.ts apps/app-backend/src/index.ts apps/app-backend/tests/document-trash-store.test.ts
git commit -m "feat: add trash auto cleanup scheduler"
```

### Task 6: 前端 API 层接入垃圾箱与新增通用配置字段

**Files:**
- Modify: `apps/web/src/api/documents.ts`
- Modify: `apps/web/src/api/general-settings.ts`
- Create: `apps/web/tests/document-trash-state.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTrashSettings } from "../src/features/document-page/trash-state";

test("normalize trash settings uses defaults when payload missing", () => {
  assert.deepEqual(normalizeTrashSettings({}), {
    trashAutoCleanupEnabled: false,
    trashAutoCleanupDays: 30,
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-trash-state.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export type TrashListItem = {
  trashId: string;
  title: string;
  entityType: "document" | "directory";
  originalPath: string;
  deletedAt: string;
};

export const fetchDocumentTrash = async (projectKey: string): Promise<TrashListItem[]> => { /* ... */ };
export const restoreDocumentTrash = async (...) => { /* ... */ };
export const purgeDocumentTrash = async (...) => { /* ... */ };
export const purgeAllDocumentTrash = async (...) => { /* ... */ };
```

并在 `GeneralSettings` 类型中增加：
- `trashAutoCleanupEnabled`
- `trashAutoCleanupDays`

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/web/tests/document-trash-state.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/api/documents.ts apps/web/src/api/general-settings.ts apps/web/tests/document-trash-state.test.ts
git commit -m "feat: add trash api client and settings types"
```

### Task 7: 文档页增加垃圾箱入口与垃圾箱面板交互

**Files:**
- Create: `apps/web/src/components/DocumentTrashPanel.tsx`
- Create: `apps/web/src/features/document-page/trash-state.ts`
- Modify: `apps/web/src/components/KnowledgeBaseSideNav.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/tests/document-trash-state.test.ts`

**Step 1: Write the failing test**

```ts
import { applyTrashActionToTree } from "../src/features/document-page/trash-state";

test("applyTrashActionToTree removes deleted ids from root and children maps", () => {
  const result = applyTrashActionToTree({
    rootDocuments: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
    childrenByParent: { a: [{ id: "c", title: "C" }] },
    deletedIds: ["a", "c"],
  });
  assert.deepEqual(result.rootDocuments.map((d) => d.id), ["b"]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-trash-state.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// KnowledgeBaseSideNav 增加垃圾箱按钮
<button className="kb-sidebar-toolbar-btn" onClick={onOpenTrash}>垃圾箱</button>

// DocumentPage 中新增 trashView 状态
const [trashPanelOpen, setTrashPanelOpen] = useState(false);
// 打开后加载 fetchDocumentTrash，渲染 DocumentTrashPanel
// panel 内支持恢复、单条彻删、清空
```

并在样式中增加：
- 垃圾箱列表布局
- 危险按钮样式
- 空状态样式

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/web/tests/document-trash-state.test.ts apps/web/tests/document-title-sync.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentTrashPanel.tsx apps/web/src/features/document-page/trash-state.ts apps/web/src/components/KnowledgeBaseSideNav.tsx apps/web/src/pages/DocumentPage.tsx apps/web/src/App.css apps/web/tests/document-trash-state.test.ts
git commit -m "feat: add document trash panel and side-nav entry"
```

### Task 8: 通用设置面板增加“垃圾箱自动清理”配置 UI

**Files:**
- Modify: `apps/web/src/components/GeneralSettingsPanel.tsx`
- Modify: `apps/web/src/App.css`
- Create: `apps/web/tests/general-settings-trash.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTrashDays } from "../src/features/document-page/trash-state";

test("normalizeTrashDays clamps invalid values", () => {
  assert.equal(normalizeTrashDays(-1), 30);
  assert.equal(normalizeTrashDays(0), 30);
  assert.equal(normalizeTrashDays(99999), 3650);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/general-settings-trash.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```tsx
<Card className="general-settings-card" title="垃圾箱自动清理">
  <div className="general-settings-row">
    <Switch checked={trashAutoCleanupEnabled} onChange={setTrashAutoCleanupEnabled} />
  </div>
  <Input
    type="number"
    min={1}
    max={3650}
    value={trashAutoCleanupDays}
    onChange={(e) => setTrashAutoCleanupDays(normalizeTrashDays(Number(e.target.value)))}
    disabled={!trashAutoCleanupEnabled}
  />
</Card>
```

保存时提交 `trash_auto_cleanup_enabled` 与 `trash_auto_cleanup_days`。

**Step 4: Run tests to verify pass**

Run: `node --import tsx --test apps/web/tests/general-settings-trash.test.ts apps/web/tests/general-settings-shortcuts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/components/GeneralSettingsPanel.tsx apps/web/src/App.css apps/web/tests/general-settings-trash.test.ts
git commit -m "feat: add trash auto cleanup controls in general settings"
```

### Task 9: 全链路回归验证（后端 + 前端 + Playwright）

**Files:**
- Create: `output/playwright/document-trash-regression.js`
- Modify: `output/playwright/test-account.json`（仅在缺失时补充，不覆盖已有账号）

**Step 1: Write the failing test/script**

```js
// output/playwright/document-trash-regression.js
// 1. 登录
// 2. 删除文档 -> 进入垃圾箱
// 3. 恢复
// 4. 再删除并清空
// 5. 断言列表为空
throw new Error("TODO: implement regression flow");
```

**Step 2: Run script to verify it fails**

Run: `node output/playwright/document-trash-regression.js`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// 从 output/playwright/test-account.json 读取账号
// 执行删除 -> 垃圾箱 -> 恢复/清空流程
```

**Step 4: Run all verification commands**

Run:
- `node --import tsx --test apps/app-backend/tests/document-trash-store.test.ts apps/app-backend/tests/document-trash-api-contract.test.ts apps/app-backend/tests/general-settings-store.test.ts apps/app-backend/tests/ddl-migrations-consolidation.test.ts`
- `node --import tsx --test apps/web/tests/document-trash-state.test.ts apps/web/tests/general-settings-trash.test.ts`
- `npm run test:unified-editor`
- `node output/playwright/document-trash-regression.js`

Expected: PASS

**Step 5: Commit**

```bash
git add output/playwright/document-trash-regression.js apps/app-backend/tests/document-trash-store.test.ts apps/app-backend/tests/document-trash-api-contract.test.ts apps/web/tests/document-trash-state.test.ts apps/web/tests/general-settings-trash.test.ts
git commit -m "test: add trash feature regression coverage"
```
