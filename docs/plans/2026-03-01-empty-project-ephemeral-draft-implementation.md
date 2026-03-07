# Empty Project Ephemeral Draft Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 当项目文档数为 0 时自动进入“无标题文档”草稿态，且未编辑不落库，首次有效编辑后再创建真实文档并进入现有自动保存链路。  
**Architecture:** 在前端引入 `ephemeral-draft` 状态机，使用虚拟文档 ID 承载临时编辑态；`DocumentWorkspace` 增加持久化门控与首改回调；`DocumentPage` 负责草稿模式切换、首改创建、路由替换和 tab/tree/breadcrumb 同步。  
**Tech Stack:** React 19 + TypeScript + react-router-dom + Node test runner (`node --test` + `tsx`) + Playwright CLI.

---

### Task 1: 建立草稿状态机纯函数与测试

**Files:**
- Create: `apps/web/src/features/document-page/ephemeral-draft-model.ts`
- Test: `apps/web/tests/ephemeral-draft-model.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EPHEMERAL_DRAFT_ID,
  shouldEnterEphemeralDraftMode,
  shouldRedirectToEphemeralDraft,
} from "../src/features/document-page/ephemeral-draft-model";

test("enters draft mode only when project has zero documents", () => {
  assert.equal(shouldEnterEphemeralDraftMode(0), true);
  assert.equal(shouldEnterEphemeralDraftMode(1), false);
});

test("redirects stale route to ephemeral draft in empty project", () => {
  assert.equal(shouldRedirectToEphemeralDraft({ totalDocumentCount: 0, routeDocId: "x" }), true);
  assert.equal(shouldRedirectToEphemeralDraft({ totalDocumentCount: 0, routeDocId: EPHEMERAL_DRAFT_ID }), false);
  assert.equal(shouldRedirectToEphemeralDraft({ totalDocumentCount: 2, routeDocId: "x" }), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/ephemeral-draft-model.test.ts`  
Expected: FAIL with module/function not found.

**Step 3: Write minimal implementation**

```ts
export const EPHEMERAL_DRAFT_ID = "__ephemeral_draft__";

export function shouldEnterEphemeralDraftMode(totalDocumentCount: number): boolean {
  return totalDocumentCount === 0;
}

export function shouldRedirectToEphemeralDraft(input: {
  totalDocumentCount: number;
  routeDocId: string;
}): boolean {
  if (!shouldEnterEphemeralDraftMode(input.totalDocumentCount)) return false;
  const current = input.routeDocId.trim();
  return current.length > 0 && current !== EPHEMERAL_DRAFT_ID;
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/ephemeral-draft-model.test.ts`  
Expected: PASS (all tests green).

**Step 5: Commit**

```bash
git add apps/web/src/features/document-page/ephemeral-draft-model.ts apps/web/tests/ephemeral-draft-model.test.ts
git commit -m "test(web): add ephemeral draft mode model and tests"
```

### Task 2: 扩展保存状态为 draft 并补充纯函数测试

**Files:**
- Modify: `apps/web/src/features/document-editor/save-state.ts`
- Modify: `apps/web/src/features/document-editor/workspace-model.ts`
- Modify: `apps/web/src/components/DocumentHeader.tsx`
- Modify: `apps/web/tests/document-workspace-autosave.test.ts`
- Test: `apps/web/tests/ephemeral-draft-workspace-model.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMeaningfulDraftChange,
  mapSaveStatusText,
} from "../src/features/document-editor/workspace-model";

test("draft change detection: default title + empty doc is not meaningful", () => {
  assert.equal(
    isMeaningfulDraftChange({
      title: "无标题文档",
      content: { type: "doc", content: [] },
      defaultTitle: "无标题文档",
    }),
    false,
  );
});

test("draft save badge text", () => {
  assert.equal(mapSaveStatusText("draft"), "草稿");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/ephemeral-draft-workspace-model.test.ts apps/web/tests/document-workspace-autosave.test.ts`  
Expected: FAIL because `"draft"` status and helper do not exist yet.

**Step 3: Write minimal implementation**

```ts
// save-state.ts
export type EditorSaveStatus = "draft" | "idle" | "dirty" | "saving" | "error";

// workspace-model.ts
export function mapSaveStatusText(status: EditorSaveStatus): string {
  if (status === "draft") return "草稿";
  ...
}

export function isMeaningfulDraftChange(input: {
  title: string;
  content: JSONContent;
  defaultTitle: string;
}): boolean {
  const titleChanged = input.title.trim() !== (input.defaultTitle || "").trim();
  const hasContent = Array.isArray(input.content?.content) && input.content.content.length > 0;
  return titleChanged || hasContent;
}

// DocumentHeader.tsx
// mapEditorSaveBadge("draft") => "草稿"
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/ephemeral-draft-workspace-model.test.ts apps/web/tests/document-workspace-autosave.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-editor/save-state.ts apps/web/src/features/document-editor/workspace-model.ts apps/web/src/components/DocumentHeader.tsx apps/web/tests/document-workspace-autosave.test.ts apps/web/tests/ephemeral-draft-workspace-model.test.ts
git commit -m "feat(web): add draft save status and meaningful draft change helpers"
```

### Task 3: 给 DocumentWorkspace 增加草稿持久化门控

**Files:**
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`
- Test: `apps/web/tests/document-workspace-ephemeral-guard.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldPersistWorkspacePayload } from "../src/components/DocumentWorkspace";

test("ephemeral mode does not persist before first meaningful change", () => {
  assert.equal(
    shouldPersistWorkspacePayload({
      persistMode: "ephemeral",
      hasMaterialized: false,
    }),
    false,
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-workspace-ephemeral-guard.test.ts`  
Expected: FAIL because guard helper/props are missing.

**Step 3: Write minimal implementation**

```ts
type PersistMode = "persisted" | "ephemeral";

type DocumentWorkspaceProps = {
  ...
  persistMode?: PersistMode;
  onFirstMeaningfulChange?: (payload: SavePayload) => Promise<void> | void;
};

// 新增本地标记，避免并发首改重复触发
const materializingRef = useRef(false);

if (persistMode === "ephemeral") {
  // 标题/正文变更时仅更新本地态，不调用 updateDocumentContent
  // 命中 isMeaningfulDraftChange 后回调 onFirstMeaningfulChange
  return;
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-workspace-ephemeral-guard.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentWorkspace.tsx apps/web/tests/document-workspace-ephemeral-guard.test.ts
git commit -m "feat(web): add ephemeral draft persistence guard in workspace"
```

### Task 4: 在 DocumentPage 接入空项目草稿状态机与首改创建

**Files:**
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/features/document-tabs/session-model.ts` (如需支持 draft 激活同步)
- Modify: `apps/web/src/features/document-tabs/snapshot-store.ts` (确保虚拟 ID 快照可替换)
- Test: `apps/web/tests/document-page-ephemeral-routing.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEmptyProjectOpenTarget } from "../src/features/document-page/ephemeral-draft-model";

test("empty project always opens ephemeral draft", () => {
  assert.equal(
    resolveEmptyProjectOpenTarget({
      totalDocumentCount: 0,
      routeDocId: "stale-doc",
      draftId: "__ephemeral_draft__",
    }),
    "__ephemeral_draft__",
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-page-ephemeral-routing.test.ts`  
Expected: FAIL because resolver and integration paths are incomplete.

**Step 3: Write minimal implementation**

```ts
// DocumentPage.tsx 关键点：
// 1) 基于 rootDocuments + childrenByParent 计算 totalDocumentCount
// 2) totalDocumentCount === 0 时导航到 /documents/__ephemeral_draft__
// 3) 构造内存 draft document 并注入 documentsById + tabSession
// 4) onFirstMeaningfulChange:
//    - 调 createDocument(...)
//    - 将 draft tab/snapshot/doc 映射替换为真实 docId
//    - navigate(`/documents/${newDocId}`, { replace: true })
// 5) 草稿模式下 editorSaveStatus = "draft"
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-page-ephemeral-routing.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/pages/DocumentPage.tsx apps/web/src/features/document-tabs/session-model.ts apps/web/src/features/document-tabs/snapshot-store.ts apps/web/tests/document-page-ephemeral-routing.test.ts
git commit -m "feat(web): auto-open ephemeral draft for empty projects and materialize on first edit"
```

### Task 5: 回归测试与 Playwright CLI 自动化脚本

**Files:**
- Create: `output/playwright/empty-project-ephemeral-draft-regression.js`
- Modify: `package.json` (将新增 node tests 纳入 `test:unified-editor`)

**Step 1: Write the failing regression script**

```js
async (page) => {
  // 读取 output/playwright/test-account.json 登录
  // 进入空项目文档页，断言出现“无标题文档”
  // 断言未输入前不触发文档创建
  // 输入一个字符后断言出现真实 /documents/:id 路由
}
```

**Step 2: Run script to verify it fails before fixes**

Run:
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" -s draft-reg open about:blank
"$PWCLI" -s draft-reg run-code "$(cat output/playwright/empty-project-ephemeral-draft-regression.js)"
"$PWCLI" -s draft-reg close
```
Expected: FAIL on old behavior (`failed to load document` / 无真实 docId 切换)。

**Step 3: Update test aggregation**

```json
{
  "scripts": {
    "test:unified-editor": "node --import tsx --test ... apps/web/tests/ephemeral-draft-model.test.ts apps/web/tests/ephemeral-draft-workspace-model.test.ts apps/web/tests/document-workspace-ephemeral-guard.test.ts apps/web/tests/document-page-ephemeral-routing.test.ts"
  }
}
```

**Step 4: Run full verification**

Run:
```bash
pnpm -s test:unified-editor
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" -s draft-reg open about:blank
"$PWCLI" -s draft-reg run-code "$(cat output/playwright/empty-project-ephemeral-draft-regression.js)"
"$PWCLI" -s draft-reg close
```
Expected: 单测全绿 + Playwright 回归通过。

**Step 5: Commit**

```bash
git add output/playwright/empty-project-ephemeral-draft-regression.js package.json
git commit -m "test(web): add playwright regression for empty-project ephemeral draft flow"
```

### Task 6: 收尾验证与文档更新

**Files:**
- Modify: `AGENTS.md`（补充此功能的测试检查点，可选）
- Modify: `docs/plans/2026-03-01-empty-project-ephemeral-draft-design.md`（如有偏差更新验收条目）

**Step 1: Write the failing checklist assertion (manual)**

```md
- [ ] 空项目进入文档页不报错
- [ ] 未编辑不落库
- [ ] 首改创建真实文档并继续自动保存
```

**Step 2: Run manual checks**

Run: 按测试账号走一次注册后首次登录 + 文档编辑路径。  
Expected: 三个检查项全部通过。

**Step 3: Update docs to reflect final behavior**

```md
在 Design 文档中标记实现完成，并写明回归脚本路径与执行命令。
```

**Step 4: Run final sanity commands**

Run:
```bash
git status --short
pnpm -s test:unified-editor
```
Expected: 仅本功能相关改动，测试全绿。

**Step 5: Commit**

```bash
git add AGENTS.md docs/plans/2026-03-01-empty-project-ephemeral-draft-design.md
git commit -m "docs: finalize empty-project ephemeral draft behavior checklist"
```
