# 文档锁定功能 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为文档增加“锁定后仅可查看”能力；锁定文档禁止本体写操作，但不影响子文档与其他文档写操作。

**Architecture:** 采用文档 `meta.extra.lock` 内嵌锁模型，不新增数据库表。后端在“写当前 docId”接口统一校验并返回 `423 DOCUMENT_LOCKED`；前端在文档页展示锁状态并切换只读，且在保存命中 423 时按策略降级为只读。

**Tech Stack:** TypeScript, Express, React, Tiptap, node:test, Playwright CLI。

---

### Task 1: 建立锁模型与后端工具函数

**Files:**
- Create: `apps/app-backend/src/services/document-lock.ts`
- Modify: `apps/app-backend/src/storage/types.ts`
- Test: `apps/app-backend/tests/document-lock-service.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  getDocumentLockInfo,
  applyDocumentLock,
  clearDocumentLock,
} from "../src/services/document-lock";

test("lock helpers read/write meta.extra.lock", () => {
  const meta = { id: "d1", title: "doc", extra: {} } as any;
  const lock = applyDocumentLock(meta, "u1", "2026-03-02T00:00:00.000Z");
  assert.equal(lock.locked, true);
  assert.equal(lock.lockedBy, "u1");
  assert.equal(getDocumentLockInfo(meta)?.locked, true);
  clearDocumentLock(meta);
  assert.equal(getDocumentLockInfo(meta), null);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-service.test.ts`  
Expected: FAIL with module/function missing.

**Step 3: Write minimal implementation**

```ts
export type DocumentLockInfo = { locked: true; lockedBy: string; lockedAt: string };

export function getDocumentLockInfo(meta: { extra?: Record<string, unknown> }): DocumentLockInfo | null { /* ... */ }
export function applyDocumentLock(meta: { extra?: Record<string, unknown> }, userId: string, nowIso: string): DocumentLockInfo { /* ... */ }
export function clearDocumentLock(meta: { extra?: Record<string, unknown> }): void { /* ... */ }
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-service.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-lock.ts apps/app-backend/src/storage/types.ts apps/app-backend/tests/document-lock-service.test.ts
git commit -m "feat(app-backend): add document lock metadata helpers"
```

### Task 2: 新增锁定/解锁 API

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/web/src/api/documents.ts`
- Test: `apps/app-backend/tests/document-lock-api-contract.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

// use test server helper to call:
// PUT /api/projects/personal/me/p1/documents/d1/lock
// DELETE /api/projects/personal/me/p1/documents/d1/lock

test("lock/unlock endpoints return lock state", async () => {
  const lockRes = await callApi("PUT", "/api/projects/personal/me/p1/documents/d1/lock");
  assert.equal(lockRes.status, 200);
  assert.equal(lockRes.body?.data?.lock?.locked, true);

  const unlockRes = await callApi("DELETE", "/api/projects/personal/me/p1/documents/d1/lock");
  assert.equal(unlockRes.status, 200);
  assert.equal(unlockRes.body?.data?.lock ?? null, null);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-api-contract.test.ts`  
Expected: FAIL with 404 route missing.

**Step 3: Write minimal implementation**

在 `router.ts` 新增两条路由：

```ts
router.put("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/lock", ...)
router.delete("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/lock", ...)
```

流程：
1. `documentStore.get(...)` 读取文档。
2. 使用 Task 1 helper 修改 `meta.extra.lock`。
3. `documentStore.save(...)` 持久化。
4. `success(res, { lock })` 返回。

同时在前端 `api/documents.ts` 增加：

```ts
export type DocumentLockInfo = { locked: true; lockedBy: string; lockedAt: string };
export async function lockDocument(projectKey: string, docId: string): Promise<DocumentLockInfo> { /* ... */ }
export async function unlockDocument(projectKey: string, docId: string): Promise<null> { /* ... */ }
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-api-contract.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/web/src/api/documents.ts apps/app-backend/tests/document-lock-api-contract.test.ts
git commit -m "feat(app-backend): add document lock and unlock endpoints"
```

### Task 3: 写接口统一加锁校验并返回 423

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Test: `apps/app-backend/tests/document-lock-guard.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("locked document blocks write endpoints with 423", async () => {
  await callApi("PUT", "/api/projects/personal/me/p1/documents/d1/lock");

  const saveRes = await callApi("PUT", "/api/projects/personal/me/p1/documents/d1", { /* ... */ });
  assert.equal(saveRes.status, 423);
  assert.equal(saveRes.body?.code, "DOCUMENT_LOCKED");

  const moveRes = await callApi("PATCH", "/api/projects/personal/me/p1/documents/d1/move", { target_parent_id: "root" });
  assert.equal(moveRes.status, 423);

  const delRes = await callApi("DELETE", "/api/projects/personal/me/p1/documents/d1");
  assert.equal(delRes.status, 423);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-guard.test.ts`  
Expected: FAIL (returns 200/204 instead of 423).

**Step 3: Write minimal implementation**

在 `router.ts` 增加公用校验函数并用于以下接口：
- `PUT /documents/:docId`
- `PATCH /documents/:docId/blocks/:blockId`
- `PATCH /documents/:docId/move`
- `DELETE /documents/:docId`
- optimize/apply proposal 写回路径

示意：

```ts
async function assertDocumentUnlockedOrThrow(userId: string, projectKey: string, docId: string) {
  const doc = await documentStore.get(userId, projectKey, docId);
  const lock = getDocumentLockInfo(doc.meta);
  if (lock?.locked) {
    const err = new Error("DOCUMENT_LOCKED");
    (err as any).code = "DOCUMENT_LOCKED";
    (err as any).status = 423;
    (err as any).lock = lock;
    throw err;
  }
}
```

在 catch 中映射为：`error(res, "DOCUMENT_LOCKED", "Document is locked", 423)`。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-guard.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/tests/document-lock-guard.test.ts
git commit -m "feat(app-backend): enforce lock guard for document writes"
```

### Task 4: 验证白名单操作不受锁影响

**Files:**
- Test: `apps/app-backend/tests/document-lock-whitelist.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("locked parent still allows create child and duplicate", async () => {
  await callApi("PUT", "/api/projects/personal/me/p1/documents/d1/lock");

  const createRes = await callApi("POST", "/api/projects/personal/me/p1/documents", {
    meta: { title: "child", parent_id: "d1" },
    body: { type: "tiptap", content: { type: "doc", content: [] } },
  });
  assert.equal(createRes.status, 201);

  const duplicateRes = await callApi("POST", "/api/projects/personal/me/p1/documents/d1/duplicate");
  assert.equal(duplicateRes.status, 200);
});
```

**Step 2: Run test to verify it fails (if over-blocked)**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-whitelist.test.ts`  
Expected: 初次可能 FAIL（若 guard 误伤）。

**Step 3: Adjust guard scope to doc-self writes only**

确保 guard 仅放在“写当前 docId 本体”的路径，不放在创建/导入/duplicate 路径。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-whitelist.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/tests/document-lock-whitelist.test.ts apps/app-backend/src/router.ts
git commit -m "test(app-backend): verify lock whitelist behaviors"
```

### Task 5: 文档页锁状态渲染与操作按钮接入

**Files:**
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/components/DocumentHeader.tsx`
- Test: `apps/web/tests/document-lock-ui-state.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mapDocumentLockViewState } from "../src/pages/DocumentPage";

test("locked doc maps to readonly ui state", () => {
  const state = mapDocumentLockViewState({ locked: true, lockedBy: "u1", lockedAt: "t" });
  assert.equal(state.readonly, true);
  assert.equal(state.showLockBadge, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-lock-ui-state.test.ts`  
Expected: FAIL (helper missing).

**Step 3: Write minimal implementation**

- `DocumentPage` 从 `activeDocument.meta.extra.lock` 解析 `isLocked`。
- `DocumentHeader` 新增 props：
  - `locked?: boolean`
  - `lockBusy?: boolean`
  - `onLockToggle?: () => void`
- 点击锁定/解锁调用 `lockDocument`/`unlockDocument`，刷新当前文档状态。
- 锁定时隐藏/禁用当前文档写操作入口（删除、优化、应用提案、手动保存等）。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-lock-ui-state.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/pages/DocumentPage.tsx apps/web/src/components/DocumentHeader.tsx apps/web/tests/document-lock-ui-state.test.ts
git commit -m "feat(web): add document lock state and header toggle"
```

### Task 6: 工作区锁定态只读与保存失败降级

**Files:**
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`
- Modify: `apps/web/src/components/RichTextEditor.tsx`
- Test: `apps/web/tests/document-workspace-lock-fallback.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { reduceLockFallbackState } from "../src/components/DocumentWorkspace";

test("save 423 transitions workspace to readonly", () => {
  const next = reduceLockFallbackState({ readonly: false }, { code: "DOCUMENT_LOCKED", status: 423 });
  assert.equal(next.readonly, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-workspace-lock-fallback.test.ts`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- `DocumentWorkspace` 增加 `locked?: boolean` 入参，控制编辑器 editable。
- 在 `saveNow` 捕获错误：若为 `DOCUMENT_LOCKED`/`423`，设置本地只读态并停止后续 schedule，通知上层 toast。
- `RichTextEditor` 增加 `mode?: "edit" | "view"`，透传到 `DocEditor`。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-workspace-lock-fallback.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentWorkspace.tsx apps/web/src/components/RichTextEditor.tsx apps/web/tests/document-workspace-lock-fallback.test.ts
git commit -m "feat(web): fallback to readonly when save hits document lock"
```

### Task 7: 标签页快照/状态同步锁字段

**Files:**
- Modify: `apps/web/src/features/document-tabs/snapshot-store.ts`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Test: `apps/web/tests/document-tabs-lock-state.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { upsertSnapshot } from "../src/features/document-tabs/snapshot-store";

test("snapshot keeps locked flag", () => {
  const out = upsertSnapshot({}, "d1", { locked: true } as any);
  assert.equal((out as any).d1.locked, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-tabs-lock-state.test.ts`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- snapshot type 新增 `locked?: boolean`。
- `DocumentPage` 在 tab 切换与恢复时携带 lock 状态，避免切回后误进入可编辑。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-tabs-lock-state.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-tabs/snapshot-store.ts apps/web/src/pages/DocumentPage.tsx apps/web/tests/document-tabs-lock-state.test.ts
git commit -m "fix(web): preserve lock state across document tabs"
```

### Task 8: 回归验证（单测 + Playwright）

**Files:**
- Create: `output/playwright/document-lock-regression.js`
- Create: `output/playwright/document-lock-regression.md`

**Step 1: Write regression script**

场景：
1. 锁定文档后，标题和正文无法修改。
2. 锁定文档下仍可新建子文档并编辑子文档。
3. 锁定文档仍可创建副本。
4. 编辑中被锁后，下次保存失败并转只读。

**Step 2: Run browser regression**

Run: `playwright-cli run output/playwright/document-lock-regression.js`  
Expected: FAIL on first run if any behavior missing.

**Step 3: Fix gaps and rerun**

按失败点最小修复，直到脚本通过。

**Step 4: Run full verification**

Run: `node --import tsx --test apps/app-backend/tests/document-lock-service.test.ts apps/app-backend/tests/document-lock-api-contract.test.ts apps/app-backend/tests/document-lock-guard.test.ts apps/app-backend/tests/document-lock-whitelist.test.ts apps/web/tests/document-lock-ui-state.test.ts apps/web/tests/document-workspace-lock-fallback.test.ts apps/web/tests/document-tabs-lock-state.test.ts`  
Expected: PASS。

Run: `npm run test:unified-editor`  
Expected: PASS。

Run: `playwright-cli run output/playwright/document-lock-regression.js`  
Expected: PASS。

**Step 5: Commit**

```bash
git add output/playwright/document-lock-regression.js output/playwright/document-lock-regression.md
git commit -m "test(web): add document lock regression coverage"
```

## Execution Notes

1. 强制流程：遵循 `@test-driven-development`，每个任务先红后绿。
2. 诊断异常：按 `@systematic-debugging` 做最小复现与根因定位。
3. 完成前验证：按 `@verification-before-completion` 执行全部命令并记录输出。
4. 前端改动回归：必须执行 `@playwright`，使用固定测试账号文件。
5. 执行阶段：使用 `superpowers:executing-plans` 逐任务推进并小步提交。
