# Document Git Versioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为项目级文档 `docs/` 引入 Git 版本管理，并按“未登录本地真相源、登录+自动同步远端真相源”完成多端同步 MVP。

**Architecture:** 在 `apps/app-backend` 新增 `document-version-service` 作为版本核心，文档操作成功后在 after-hook 触发 commit；同步采用项目级串行队列异步 push。配置从全局 `general_settings` 升级为用户级 `user_general_settings`，前端通过 `settings/general` 控制自动同步开关。

**Tech Stack:** TypeScript (Express, simple-git), PostgreSQL/SQLite SQL, React + Ant Design, Node built-in test runner (`node --test` + `tsx`)

---

**Execution Skills:** @superpowers/test-driven-development, @superpowers/verification-before-completion, @superpowers/requesting-code-review

### Task 1: 用户级通用配置 Schema（`user_general_settings`）

**Files:**
- Create: `ddl/migrations/server.postgres/20260302-002-document-sync-settings/up.sql`
- Create: `ddl/migrations/server.postgres/20260302-002-document-sync-settings/down.sql`
- Create: `ddl/migrations/desktop.sqlite/20260302-002-document-sync-settings/up.sql`
- Create: `ddl/migrations/desktop.sqlite/20260302-002-document-sync-settings/down.sql`
- Create: `ddl/migrations/mobile.sqlite/20260302-002-document-sync-settings/up.sql`
- Create: `ddl/migrations/mobile.sqlite/20260302-002-document-sync-settings/down.sql`
- Modify: `ddl/sql/init.sql`
- Modify: `ddl/sql/init.server.postgres.sql`
- Modify: `ddl/sql/init.desktop.sqlite.sql`
- Modify: `ddl/sql/init.mobile.sqlite.sql`
- Modify: `deploy/helm/charts/charts/postgres/files/init.sql`
- Test: `apps/app-backend/tests/ddl-init-snapshots.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("ddl snapshot includes user_general_settings with document_auto_sync", () => {
  const ddl = readFileSync("ddl/sql/init.sql", "utf8");
  assert.match(ddl, /CREATE TABLE\s+user_general_settings/i);
  assert.match(ddl, /document_auto_sync\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+false/i);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/app-backend/tests/ddl-init-snapshots.test.ts`
Expected: FAIL，提示缺少 `user_general_settings` 或 `document_auto_sync`。

**Step 3: Write minimal implementation**

```sql
CREATE TABLE IF NOT EXISTS user_general_settings (
  user_id TEXT PRIMARY KEY,
  use_remote_knowledge_base BOOLEAN NOT NULL DEFAULT false,
  document_auto_sync BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/app-backend/tests/ddl-init-snapshots.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add ddl/migrations/server.postgres/20260302-002-document-sync-settings/up.sql ddl/migrations/server.postgres/20260302-002-document-sync-settings/down.sql ddl/migrations/desktop.sqlite/20260302-002-document-sync-settings/up.sql ddl/migrations/desktop.sqlite/20260302-002-document-sync-settings/down.sql ddl/migrations/mobile.sqlite/20260302-002-document-sync-settings/up.sql ddl/migrations/mobile.sqlite/20260302-002-document-sync-settings/down.sql ddl/sql/init.sql ddl/sql/init.server.postgres.sql ddl/sql/init.desktop.sqlite.sql ddl/sql/init.mobile.sqlite.sql deploy/helm/charts/charts/postgres/files/init.sql
git commit -m "feat(settings): add user_general_settings schema with document_auto_sync"
```

### Task 2: 重构 `general-settings-store` 为用户级 API

**Files:**
- Modify: `apps/app-backend/src/services/general-settings-store.ts`
- Create: `apps/app-backend/tests/general-settings-store.test.ts`

**Step 1: Write the failing test**

```ts
test("general-settings-store: keeps settings isolated per user", async () => {
  const store = createGeneralSettingsStoreForTest(mockQuery);
  await store.update("user-a", { documentAutoSync: true });
  await store.update("user-b", { documentAutoSync: false });

  const a = await store.get("user-a");
  const b = await store.get("user-b");
  assert.equal(a.documentAutoSync, true);
  assert.equal(b.documentAutoSync, false);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/general-settings-store.test.ts`
Expected: FAIL，`get/update` 仍是单例语义。

**Step 3: Write minimal implementation**

```ts
export type GeneralSettings = {
  useRemoteKnowledgeBase: boolean;
  documentAutoSync: boolean;
};

async function get(userId: string): Promise<GeneralSettings> { /* SELECT ... WHERE user_id = $1 */ }
async function update(userId: string, input: GeneralSettingsInput): Promise<GeneralSettings> { /* UPSERT by user_id */ }
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/general-settings-store.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/general-settings-store.ts apps/app-backend/tests/general-settings-store.test.ts
git commit -m "refactor(settings): make general settings user-scoped"
```

### Task 3: 扩展 `/settings/general` API（含登录约束）

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Create: `apps/app-backend/src/services/general-settings-auth.ts`
- Create: `apps/app-backend/tests/general-settings-auth.test.ts`

**Step 1: Write the failing test**

```ts
test("general-settings-auth: unauthenticated request resolves local-only mode", () => {
  const mode = resolveSyncMode({ isAuthenticated: false, documentAutoSync: true });
  assert.equal(mode, "local_only");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/general-settings-auth.test.ts`
Expected: FAIL，缺少 resolver 或返回结果不符合规则。

**Step 3: Write minimal implementation**

```ts
export function resolveSyncMode(input: { isAuthenticated: boolean; documentAutoSync: boolean }) {
  if (!input.isAuthenticated) return "local_only" as const;
  return input.documentAutoSync ? "remote_enabled" as const : "local_only" as const;
}
```

并在 `router.ts` 中实现：
- `GET /settings/general`：优先用 `req.user?.id`，未登录返回默认配置。
- `PUT /settings/general`：继续 `authMiddleware`，支持 `document_auto_sync` 字段。

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/general-settings-auth.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/src/services/general-settings-auth.ts apps/app-backend/tests/general-settings-auth.test.ts
git commit -m "feat(settings): support document_auto_sync in general settings api"
```

### Task 4: 构建文档版本核心（commit message + 本地提交）

**Files:**
- Create: `apps/app-backend/src/services/document-version/types.ts`
- Create: `apps/app-backend/src/services/document-version/commit-message.ts`
- Create: `apps/app-backend/src/services/document-version/git-repo.ts`
- Create: `apps/app-backend/src/services/document-version/service.ts`
- Create: `apps/app-backend/tests/document-version-service.test.ts`

**Step 1: Write the failing test**

```ts
test("document-version-service: creates one commit per document.update event", async () => {
  const svc = createDocumentVersionServiceForTest({ git: fakeGit });
  await svc.recordVersion({ event: "document.update", projectRef: "personal::u1::demo", payload: { docId: "d1" } });
  assert.equal(fakeGit.commitCalls.length, 1);
  assert.match(fakeGit.commitCalls[0].message, /^docs\(update\): d1/);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-service.test.ts`
Expected: FAIL，服务不存在或未提交。

**Step 3: Write minimal implementation**

```ts
export async function recordVersion(evt: DocumentVersionEvent): Promise<{ commit?: string }> {
  await git.add("docs");
  const message = buildCommitMessage(evt);
  const commit = await git.commit(message);
  return { commit };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-service.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-version/types.ts apps/app-backend/src/services/document-version/commit-message.ts apps/app-backend/src/services/document-version/git-repo.ts apps/app-backend/src/services/document-version/service.ts apps/app-backend/tests/document-version-service.test.ts
git commit -m "feat(doc-version): add local git commit service for document events"
```

### Task 5: 接入文档 after-hook（不阻塞主流程）

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Create: `apps/app-backend/src/services/document-version/dispatch.ts`
- Create: `apps/app-backend/tests/document-version-dispatch.test.ts`

**Step 1: Write the failing test**

```ts
test("document-version-dispatch: does not throw when versioning fails", async () => {
  const run = createDocumentVersionDispatcher({ recordVersion: async () => { throw new Error("git down"); } });
  await assert.doesNotReject(() => run({ event: "document.update", projectRef: "personal::u1::demo", payload: { docId: "d1" } }));
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-dispatch.test.ts`
Expected: FAIL。

**Step 3: Write minimal implementation**

```ts
export function createDocumentVersionDispatcher(deps: { recordVersion: (e: DocumentVersionEvent) => Promise<unknown> }) {
  return async (event: DocumentVersionEvent) => {
    try {
      await deps.recordVersion(event);
    } catch (err) {
      console.warn("[doc-version] record failed", err);
    }
  };
}
```

并在 `router.ts` 的 `dispatchDocumentAfterHooks(...)` 后追加 `void dispatchVersionEvent(...)`。

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-dispatch.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/src/services/document-version/dispatch.ts apps/app-backend/tests/document-version-dispatch.test.ts
git commit -m "feat(doc-version): dispatch version events from document after-hooks"
```

### Task 6: 远端同步队列（本地优先强推）

**Files:**
- Create: `apps/app-backend/src/services/document-version/sync-queue.ts`
- Create: `apps/app-backend/src/services/document-version/sync-on-open.ts`
- Create: `apps/app-backend/tests/document-version-sync-queue.test.ts`

**Step 1: Write the failing test**

```ts
test("sync queue: diverged branch uses force-with-lease push", async () => {
  const git = fakeGitRepo({ relation: "diverged" });
  const queue = createProjectSyncQueue({ git, retry: { maxAttempts: 1 } });
  await queue.enqueueSyncOnOpen({ projectRef: "personal::u1::demo", mode: "remote_enabled" });
  assert.deepEqual(git.pushArgs[0], ["origin", "main", { forceWithLease: true }]);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-sync-queue.test.ts`
Expected: FAIL。

**Step 3: Write minimal implementation**

```ts
if (relation === "diverged") {
  await git.tag(`backup/pre-force-${Date.now()}`);
  await git.push("origin", branch, { forceWithLease: true });
}
```

并实现退避重试（1/2/5/10/20 秒）。

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-sync-queue.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-version/sync-queue.ts apps/app-backend/src/services/document-version/sync-on-open.ts apps/app-backend/tests/document-version-sync-queue.test.ts
git commit -m "feat(doc-version): add remote sync queue with local-first force push"
```

### Task 7: 提供 `syncOnOpen` API 并接入前端文档页

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/web/src/api/documents.ts`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Test: `apps/app-backend/tests/document-version-sync-route.test.ts`

**Step 1: Write the failing test**

```ts
test("sync route: returns accepted when sync task enqueued", async () => {
  const res = await callSyncRouteForTest({ projectRef: "personal::me::demo" });
  assert.equal(res.code, "OK");
  assert.equal(res.data.status, "queued");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-sync-route.test.ts`
Expected: FAIL，路由不存在。

**Step 3: Write minimal implementation**

```ts
router.post("/projects/:ownerType/:ownerKey/:projectKey/documents/sync", async (req, res) => {
  await documentVersionService.syncOnOpen({ req });
  success(res, { status: "queued" }, 202);
});
```

前端增加：

```ts
export async function syncProjectDocuments(projectRef: string): Promise<void> {
  await apiFetch(`/api/projects/${encodeProjectRef(projectRef)}/documents/sync`, { method: "POST" });
}
```

并在 `DocumentPage.tsx` 项目切换时调用一次。

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/document-version-sync-route.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/web/src/api/documents.ts apps/web/src/pages/DocumentPage.tsx apps/app-backend/tests/document-version-sync-route.test.ts
git commit -m "feat(doc-version): add sync-on-open route and frontend trigger"
```

### Task 8: 通用配置 UI 增加“文档自动同步”并完成回归验证

**Files:**
- Modify: `apps/web/src/api/general-settings.ts`
- Modify: `apps/web/src/components/GeneralSettingsPanel.tsx`
- Modify: `apps/web/src/config/api.ts`
- Test: `apps/app-backend/tests/general-settings-store.test.ts`

**Step 1: Write the failing test**

```ts
test("general-settings-store: persists documentAutoSync flag", async () => {
  const store = createGeneralSettingsStoreForTest(mockQuery);
  await store.update("user-1", { documentAutoSync: true });
  const next = await store.get("user-1");
  assert.equal(next.documentAutoSync, true);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus/apps/app-backend && node --import tsx --test tests/general-settings-store.test.ts`
Expected: FAIL。

**Step 3: Write minimal implementation**

```ts
export type GeneralSettings = {
  useRemoteKnowledgeBase: boolean;
  documentAutoSync: boolean;
};
```

```tsx
<Switch
  checked={documentAutoSync}
  onChange={setDocumentAutoSync}
  disabled={!isAuthenticated || saving}
/>
```

**Step 4: Run verification to ensure integration works**

Run: `cd /Users/darin/mine/code/zeus && pnpm --filter zeus-app-backend exec node --import tsx --test apps/app-backend/tests/general-settings-store.test.ts && pnpm --filter zeus-web build`
Expected: 后端测试 PASS，前端构建 PASS。

**Step 5: Commit**

```bash
git add apps/web/src/api/general-settings.ts apps/web/src/components/GeneralSettingsPanel.tsx apps/web/src/config/api.ts apps/app-backend/tests/general-settings-store.test.ts
git commit -m "feat(web-settings): add document auto sync toggle"
```

### Task 9: 端到端验证与发布说明

**Files:**
- Modify: `docs/plans/2026-02-27-document-git-versioning-design.md`
- Create: `docs/plans/2026-02-27-document-git-versioning-rollout-checklist.md`

**Step 1: Write the failing checklist assertion**

```md
- [ ] 未登录时：文档更新后仅本地有新 commit，远端无 push。
- [ ] 登录且开启自动同步：文档更新后远端分支出现新 commit。
- [ ] 分叉场景：本地强推覆盖远端，并生成 backup 标签。
```

**Step 2: Run manual validation in dev**

Run:
- `make run-server`
- `make run-app-backend`
- `make run-app-web`
Expected: 三个场景均可复现并通过。

**Step 3: Write rollout checklist and rollback notes**

```md
Rollback: 关闭 document_auto_sync；停用 sync queue；保留本地 commit，不再 push。
```

**Step 4: Run final verification bundle**

Run: `cd /Users/darin/mine/code/zeus && pnpm --filter zeus-app-backend build && pnpm --filter zeus-web build`
Expected: PASS。

**Step 5: Commit**

```bash
git add docs/plans/2026-02-27-document-git-versioning-design.md docs/plans/2026-02-27-document-git-versioning-rollout-checklist.md
git commit -m "docs(release): add git versioning rollout checklist"
```

