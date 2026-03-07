# Notion-Like Unified Document Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify document read/edit into one always-editable page with desktop left-side `+` block insertion and robust auto-save.

**Architecture:** Keep `DocumentPage` as shell and introduce a `DocumentWorkspace` state container for load/edit/auto-save. Extend `@zeus/doc-editor` with a desktop-only block add handle extension that inserts built-in blocks via existing editor commands. Auto-save uses a debounced, serialized queue with recoverable error state.

**Tech Stack:** React 19, TypeScript, Tiptap (`@tiptap/react`), `@zeus/doc-editor`, Node test runner (`node --import tsx --test`), Vite/TypeScript build.

---

### Task 1: Build Auto-Save Scheduler Core (Pure Logic)

**Files:**
- Create: `apps/web/src/features/document-editor/save-scheduler.ts`
- Create: `apps/web/tests/save-scheduler.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaveScheduler } from "../src/features/document-editor/save-scheduler";

test("scheduler coalesces rapid changes into latest payload", async () => {
  const calls: string[] = [];
  const scheduler = createSaveScheduler({
    debounceMs: 20,
    save: async (payload: string) => {
      calls.push(payload);
    },
  });

  scheduler.schedule("v1");
  scheduler.schedule("v2");
  scheduler.schedule("v3");
  await scheduler.flush();

  assert.deepEqual(calls, ["v3"]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/save-scheduler.test.ts`
Expected: FAIL with module/function not found.

**Step 3: Write minimal implementation**

```ts
export function createSaveScheduler<T>(opts: {
  debounceMs: number;
  save: (payload: T) => Promise<void>;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: T | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const run = async () => {
    if (latest == null) return;
    const payload = latest;
    latest = null;
    await opts.save(payload);
  };

  return {
    schedule(payload: T) {
      latest = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        inFlight = inFlight.then(run);
      }, opts.debounceMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      inFlight = inFlight.then(run);
      await inFlight;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/save-scheduler.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-editor/save-scheduler.ts apps/web/tests/save-scheduler.test.ts
git commit -m "feat(web): add autosave scheduler core"
```

### Task 2: Add Auto-Save State Reducer (idle/dirty/saving/error)

**Files:**
- Create: `apps/web/src/features/document-editor/save-state.ts`
- Create: `apps/web/tests/save-state.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceSaveState, initialSaveState } from "../src/features/document-editor/save-state";

test("transitions dirty -> saving -> idle", () => {
  let state = initialSaveState();
  state = reduceSaveState(state, { type: "changed" });
  state = reduceSaveState(state, { type: "save-start" });
  state = reduceSaveState(state, { type: "save-success" });
  assert.equal(state.status, "idle");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/save-state.test.ts`
Expected: FAIL with missing exports.

**Step 3: Write minimal implementation**

```ts
export type SaveStatus = "idle" | "dirty" | "saving" | "error";

export function initialSaveState() {
  return { status: "idle" as SaveStatus, error: "" };
}

export function reduceSaveState(
  state: { status: SaveStatus; error: string },
  event: { type: "changed" | "save-start" | "save-success" | "save-error"; error?: string },
) {
  switch (event.type) {
    case "changed":
      return { status: state.status === "saving" ? "saving" : "dirty", error: "" };
    case "save-start":
      return { status: "saving", error: "" };
    case "save-success":
      return { status: "idle", error: "" };
    case "save-error":
      return { status: "error", error: event.error || "save failed" };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/save-state.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-editor/save-state.ts apps/web/tests/save-state.test.ts
git commit -m "feat(web): add autosave state reducer"
```

### Task 3: Create DocumentWorkspace Container

**Files:**
- Create: `apps/web/src/components/DocumentWorkspace.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Test: `apps/web/tests/document-workspace-model.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldFlushOn } from "../src/components/DocumentWorkspace";

test("flushes on route-leave and project-switch", () => {
  assert.equal(shouldFlushOn("route-leave"), true);
  assert.equal(shouldFlushOn("project-switch"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-workspace-model.test.ts`
Expected: FAIL with missing module/export.

**Step 3: Write minimal implementation**

```tsx
export function shouldFlushOn(reason: string): boolean {
  return reason === "route-leave" || reason === "project-switch" || reason === "window-blur";
}

export default function DocumentWorkspace(props: {
  projectKey: string;
  documentId: string;
  onSaveStatus: (status: "idle" | "dirty" | "saving" | "error", error?: string) => void;
}) {
  // TODO: wire fetchDocument + RichTextEditor + save scheduler
  return null;
}
```

Then in `DocumentPage.tsx` mount `DocumentWorkspace` where current viewer body is rendered for document detail path.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-workspace-model.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentWorkspace.tsx apps/web/src/pages/DocumentPage.tsx apps/web/tests/document-workspace-model.test.ts
git commit -m "feat(web): scaffold unified document workspace"
```

### Task 4: Wire Auto-Save into DocumentWorkspace

**Files:**
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`
- Modify: `apps/web/src/api/documents.ts`
- Test: `apps/web/tests/document-workspace-autosave.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSaveStatusText } from "../src/components/DocumentWorkspace";

test("maps save status text", () => {
  assert.equal(mapSaveStatusText("saving"), "保存中...");
  assert.equal(mapSaveStatusText("error"), "保存失败");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-workspace-autosave.test.ts`
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```tsx
export function mapSaveStatusText(status: "idle" | "dirty" | "saving" | "error") {
  if (status === "saving") return "保存中...";
  if (status === "error") return "保存失败";
  if (status === "dirty") return "待保存";
  return "已保存";
}
```

Then connect scheduler + reducer:
- `onChange` -> `changed`
- debounce save via existing document update API
- `blur/project-switch/unmount` -> `flush()`

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-workspace-autosave.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentWorkspace.tsx apps/web/src/api/documents.ts apps/web/tests/document-workspace-autosave.test.ts
git commit -m "feat(web): implement unified page autosave flow"
```

### Task 5: Add Block Add Handle Model in doc-editor

**Files:**
- Create: `packages/doc-editor/src/extensions/block-add-handle.ts`
- Create: `packages/doc-editor/tests/block-add-handle.test.ts`
- Modify: `packages/doc-editor/src/index.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDesktopHandleEnabled } from "../src/extensions/block-add-handle";

test("only desktop edit mode enables block add handle", () => {
  assert.equal(isDesktopHandleEnabled({ isMobile: false, mode: "edit" }), true);
  assert.equal(isDesktopHandleEnabled({ isMobile: true, mode: "edit" }), false);
  assert.equal(isDesktopHandleEnabled({ isMobile: false, mode: "view" }), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`
Expected: FAIL with missing module/export.

**Step 3: Write minimal implementation**

```ts
export function isDesktopHandleEnabled(input: { isMobile: boolean; mode: "edit" | "view" }) {
  return !input.isMobile && input.mode === "edit";
}

export type BuiltinBlockType =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "horizontal-rule"
  | "code-block"
  | "image"
  | "file"
  | "table";
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-add-handle.ts packages/doc-editor/src/index.ts packages/doc-editor/tests/block-add-handle.test.ts
git commit -m "feat(doc-editor): add block handle extension model"
```

### Task 6: Render Desktop Left `+` Handle and Built-in Block Menu

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.scss`
- Create: `packages/doc-editor/src/ui/block-add-menu.tsx`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { getBuiltinBlockItems } from "../src/ui/block-add-menu";

test("builtin block menu exposes expected first-phase blocks", () => {
  const ids = getBuiltinBlockItems().map((i) => i.id);
  assert.deepEqual(ids, [
    "paragraph","heading-1","heading-2","heading-3",
    "bullet-list","ordered-list","task-list",
    "blockquote","horizontal-rule","code-block","image","file","table",
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`
Expected: FAIL with missing export or mismatch.

**Step 3: Write minimal implementation**

```tsx
// block-add-menu.tsx
export function getBuiltinBlockItems() {
  return [
    { id: "paragraph", label: "段落" },
    { id: "heading-1", label: "标题 1" },
    // ...
    { id: "table", label: "表格" },
  ];
}
```

Then in `DocEditor`:
- show handle in desktop edit mode
- click item -> execute existing command chain (no new node type)
- keep existing toolbar and slash command intact

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/templates/simple/doc-editor.scss packages/doc-editor/src/ui/block-add-menu.tsx packages/doc-editor/tests/block-add-handle.test.ts
git commit -m "feat(doc-editor): add desktop left plus block insertion"
```

### Task 7: Connect Save Status UI to Document Header

**Files:**
- Modify: `apps/web/src/components/DocumentHeader.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/App.css`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapEditorSaveBadge } from "../src/components/DocumentHeader";

test("maps editor save badge", () => {
  assert.equal(mapEditorSaveBadge("saving"), "保存中");
  assert.equal(mapEditorSaveBadge("idle"), "已保存");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-workspace-autosave.test.ts`
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export function mapEditorSaveBadge(status: "idle"|"dirty"|"saving"|"error") {
  if (status === "saving") return "保存中";
  if (status === "error") return "保存失败";
  if (status === "dirty") return "待保存";
  return "已保存";
}
```

Wire `DocumentWorkspace` save state into `DocumentHeader` while keeping sync status display separate.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-workspace-autosave.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentHeader.tsx apps/web/src/pages/DocumentPage.tsx apps/web/src/App.css apps/web/tests/document-workspace-autosave.test.ts
git commit -m "feat(web): show unified page autosave status"
```

### Task 8: Route Compatibility and NewDocumentPage Degradation

**Files:**
- Modify: `apps/web/src/pages/NewDocumentPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/tests/new-document-compat.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegacyEditRedirect } from "../src/pages/NewDocumentPage";

test("legacy edit route redirects to unified page", () => {
  assert.equal(
    buildLegacyEditRedirect({ documentId: "doc-1" }),
    "/documents/doc-1"
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/new-document-compat.test.ts`
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export function buildLegacyEditRedirect(input: { documentId?: string; parentId?: string }) {
  if (input.documentId) return `/documents/${encodeURIComponent(input.documentId)}`;
  return "/documents";
}
```

Use this in `NewDocumentPage` to redirect old edit URL to unified page; keep create-new route compatibility.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/new-document-compat.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/pages/NewDocumentPage.tsx apps/web/src/App.tsx apps/web/tests/new-document-compat.test.ts
git commit -m "refactor(web): route legacy edit flow to unified document page"
```

### Task 9: Verification, Regression Checklist, and Final Build

**Files:**
- Modify: `docs/plans/2026-02-27-notion-like-unified-editor-implementation.md` (mark done checklist)

**Step 1: Run targeted tests**

Run:
- `node --import tsx --test apps/web/tests/save-scheduler.test.ts`
- `node --import tsx --test apps/web/tests/save-state.test.ts`
- `node --import tsx --test apps/web/tests/document-workspace-model.test.ts`
- `node --import tsx --test apps/web/tests/document-workspace-autosave.test.ts`
- `node --import tsx --test apps/web/tests/new-document-compat.test.ts`
- `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`

Expected: PASS.

**Step 2: Run full build verification**

Run:
- `pnpm --filter @zeus/doc-editor --silent exec tsc --noEmit`
- `pnpm --filter zeus-web build`

Expected: PASS.

**Step 3: Manual verification checklist**

- Open `/documents/:id` and type continuously for 60s: no flicker
- Confirm auto-save badge transitions: `待保存 -> 保存中 -> 已保存`
- Simulate API error: state shows `保存失败` and recovers after retry/input
- Hover desktop block line left side: `+` appears and inserts selected block
- Mobile viewport: no left handle, toolbar and `/` still usable

**Step 4: Final commit**

```bash
git add apps/web/src apps/web/tests packages/doc-editor/src packages/doc-editor/tests
git commit -m "feat(web): ship notion-like unified editable document page"
```

