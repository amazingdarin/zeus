# 文档页多页面缓存与位置还原 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在文档顶部栏支持最多 8 个页签缓存，并在切换页签时恢复滚动位置、光标位置和未保存草稿。

**Architecture:** 采用 KeepAlive 多实例方案：`DocumentPage` 维护 tab 会话状态与 LRU，最多同时挂载 8 个 `DocumentWorkspace` 实例，非激活实例隐藏但不卸载。路由仍作为激活文档真值，通过 URL 同步切换。关闭/淘汰页签前强制 flush，避免静默丢稿。

**Tech Stack:** React 19 + TypeScript, React Router, Tiptap (`@tiptap/react`), Ant Design, Node test runner (`node --import tsx --test`), Vite build.

---

> 执行要求：全程遵循 @superpowers:test-driven-development 与 @superpowers:verification-before-completion。

### Task 1: 实现 Tab Session 状态机（纯函数 + LRU）

**Files:**
- Create: `apps/web/src/features/document-tabs/session-model.ts`
- Create: `apps/web/tests/document-tabs-session-model.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialSessionState, openTab, activateTab, closeTab } from "../src/features/document-tabs/session-model";

test("openTab deduplicates existing doc tab", () => {
  let state = createInitialSessionState();
  state = openTab(state, { docId: "a", title: "A", now: 1, maxTabs: 8 });
  state = openTab(state, { docId: "a", title: "A2", now: 2, maxTabs: 8 });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.activeDocId, "a");
});

test("openTab evicts least recently used when max reached", () => {
  let state = createInitialSessionState();
  state = openTab(state, { docId: "a", title: "A", now: 1, maxTabs: 2 });
  state = openTab(state, { docId: "b", title: "B", now: 2, maxTabs: 2 });
  state = activateTab(state, { docId: "a", now: 3 });
  state = openTab(state, { docId: "c", title: "C", now: 4, maxTabs: 2 });
  assert.deepEqual(state.tabs.map((t) => t.docId).sort(), ["a", "c"]);
});

test("closeTab picks fallback active tab by last access", () => {
  let state = createInitialSessionState();
  state = openTab(state, { docId: "a", title: "A", now: 1, maxTabs: 8 });
  state = openTab(state, { docId: "b", title: "B", now: 2, maxTabs: 8 });
  state = activateTab(state, { docId: "a", now: 3 });
  state = closeTab(state, { docId: "a" });
  assert.equal(state.activeDocId, "b");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
Expected: FAIL with missing module/exports.

**Step 3: Write minimal implementation**

```ts
export type DocTab = {
  docId: string;
  title: string;
  openedAt: number;
  lastAccessAt: number;
};

export type TabSessionState = {
  tabs: DocTab[];
  activeDocId: string | null;
};

export function createInitialSessionState(): TabSessionState {
  return { tabs: [], activeDocId: null };
}

export function activateTab(state: TabSessionState, input: { docId: string; now: number }): TabSessionState {
  const tabs = state.tabs.map((tab) =>
    tab.docId === input.docId ? { ...tab, lastAccessAt: input.now } : tab,
  );
  return { tabs, activeDocId: input.docId };
}

export function openTab(
  state: TabSessionState,
  input: { docId: string; title: string; now: number; maxTabs: number },
): TabSessionState {
  const existing = state.tabs.find((t) => t.docId === input.docId);
  if (existing) {
    return activateTab(
      {
        tabs: state.tabs.map((t) =>
          t.docId === input.docId
            ? { ...t, title: input.title || t.title, lastAccessAt: input.now }
            : t,
        ),
        activeDocId: state.activeDocId,
      },
      { docId: input.docId, now: input.now },
    );
  }

  let tabs = [...state.tabs];
  if (tabs.length >= input.maxTabs) {
    const victim = [...tabs].sort((a, b) => a.lastAccessAt - b.lastAccessAt)[0];
    tabs = tabs.filter((t) => t.docId !== victim.docId);
  }

  tabs.push({
    docId: input.docId,
    title: input.title,
    openedAt: input.now,
    lastAccessAt: input.now,
  });

  return { tabs, activeDocId: input.docId };
}

export function closeTab(state: TabSessionState, input: { docId: string }): TabSessionState {
  const tabs = state.tabs.filter((t) => t.docId !== input.docId);
  if (!tabs.length) {
    return { tabs: [], activeDocId: null };
  }
  if (state.activeDocId !== input.docId) {
    return { tabs, activeDocId: state.activeDocId };
  }
  const fallback = [...tabs].sort((a, b) => b.lastAccessAt - a.lastAccessAt)[0];
  return { tabs, activeDocId: fallback.docId };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-tabs/session-model.ts apps/web/tests/document-tabs-session-model.test.ts
git commit -m "feat(web): add document tab session state model"
```

### Task 2: 实现 Snapshot Store（scroll/selection/draft）纯逻辑

**Files:**
- Create: `apps/web/src/features/document-tabs/snapshot-store.ts`
- Create: `apps/web/tests/document-tabs-snapshot-store.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSnapshotStore, upsertSnapshot, removeSnapshot } from "../src/features/document-tabs/snapshot-store";

test("upsertSnapshot writes by docId", () => {
  let store = createSnapshotStore();
  store = upsertSnapshot(store, "a", {
    scrollTop: 100,
    selection: { from: 1, to: 3 },
    draftTitle: "A",
    draftContent: { type: "doc", content: [] },
    saveStatus: "dirty",
  });
  assert.equal(store.a.scrollTop, 100);
});

test("removeSnapshot deletes key", () => {
  let store = createSnapshotStore();
  store = upsertSnapshot(store, "a", {
    scrollTop: 0,
    selection: null,
    draftTitle: "",
    draftContent: { type: "doc", content: [] },
    saveStatus: "idle",
  });
  store = removeSnapshot(store, "a");
  assert.equal("a" in store, false);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-snapshot-store.test.ts`
Expected: FAIL with missing module/exports.

**Step 3: Write minimal implementation**

```ts
import type { JSONContent } from "@tiptap/react";

export type DocSnapshot = {
  scrollTop: number;
  selection: { from: number; to: number } | null;
  draftTitle: string;
  draftContent: JSONContent;
  saveStatus: "idle" | "dirty" | "saving" | "error";
};

export type SnapshotStore = Record<string, DocSnapshot>;

export function createSnapshotStore(): SnapshotStore {
  return {};
}

export function upsertSnapshot(store: SnapshotStore, docId: string, snapshot: DocSnapshot): SnapshotStore {
  return { ...store, [docId]: snapshot };
}

export function removeSnapshot(store: SnapshotStore, docId: string): SnapshotStore {
  const next = { ...store };
  delete next[docId];
  return next;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-snapshot-store.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-tabs/snapshot-store.ts apps/web/tests/document-tabs-snapshot-store.test.ts
git commit -m "feat(web): add document tab snapshot store"
```

### Task 3: 为 DocumentWorkspace 增加桥接接口（capture/restore/flush）

**Files:**
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`
- Create: `apps/web/src/features/document-tabs/workspace-bridge.ts`
- Create: `apps/web/tests/document-workspace-bridge.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { toSelectionRange } from "../src/features/document-tabs/workspace-bridge";

test("toSelectionRange maps tiptap selection to plain range", () => {
  const range = toSelectionRange({ from: 3, to: 8 });
  assert.deepEqual(range, { from: 3, to: 8 });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-workspace-bridge.test.ts`
Expected: FAIL with missing module/export.

**Step 3: Write minimal implementation + workspace bridge wiring**

```ts
// workspace-bridge.ts
export type SelectionLike = { from: number; to: number } | null | undefined;
export function toSelectionRange(selection: SelectionLike): { from: number; to: number } | null {
  if (!selection) return null;
  return { from: selection.from, to: selection.to };
}
```

```tsx
// DocumentWorkspace.tsx (core idea)
export type WorkspaceBridge = {
  captureSnapshot: () => {
    scrollTop: number;
    selection: { from: number; to: number } | null;
    draftTitle: string;
    draftContent: JSONContent;
    saveStatus: "idle" | "dirty" | "saving" | "error";
  };
  restoreSnapshot: (snapshot: {
    scrollTop: number;
    selection: { from: number; to: number } | null;
    draftTitle: string;
    draftContent: JSONContent;
  }) => void;
  flush: () => Promise<void>;
};

// 新增 prop
onBridgeBind?: (bridge: WorkspaceBridge | null) => void;

// 在 useEffect 中 bind/unbind
onBridgeBind?.({ captureSnapshot, restoreSnapshot, flush: () => flushPending("route-leave") });
```

**Step 4: Run test to verify it passes + compile check**

Run:
1. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-workspace-bridge.test.ts`
2. `cd /Users/darin/mine/code/zeus && npm --prefix apps/web run build`
Expected: test PASS, build PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentWorkspace.tsx apps/web/src/features/document-tabs/workspace-bridge.ts apps/web/tests/document-workspace-bridge.test.ts
git commit -m "feat(web): expose document workspace bridge for tab snapshots"
```

### Task 4: 新增顶部页签栏组件（UI 纯渲染）

**Files:**
- Create: `apps/web/src/components/DocumentTabBar.tsx`
- Modify: `apps/web/src/App.css`

**Step 1: Write a minimal failing test for tab label helper**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { toTabLabel } from "../src/components/DocumentTabBar";

test("toTabLabel trims and falls back", () => {
  assert.equal(toTabLabel("  Hello  "), "Hello");
  assert.equal(toTabLabel("   "), "无标题文档");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tab-bar.test.ts`
Expected: FAIL (missing file/export).

**Step 3: Write minimal implementation**

```tsx
export function toTabLabel(title: string): string {
  const trimmed = title.trim();
  return trimmed || "无标题文档";
}

export default function DocumentTabBar(props: {
  tabs: Array<{ docId: string; title: string }>;
  activeDocId: string | null;
  onActivate: (docId: string) => void;
  onClose: (docId: string) => void;
}) {
  // 渲染标签、激活态、关闭按钮
  return null;
}
```

并在 `App.css` 增加 `.doc-page-tabbar`、`.doc-page-tab-item`、`.doc-page-tab-item.active` 样式。

**Step 4: Run test/build**

Run:
1. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tab-bar.test.ts`
2. `cd /Users/darin/mine/code/zeus && npm --prefix apps/web run build`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/components/DocumentTabBar.tsx apps/web/tests/document-tab-bar.test.ts apps/web/src/App.css
git commit -m "feat(web): add document top tab bar component"
```

### Task 5: 在 DocumentPage 集成 tabs + keepalive workspaces

**Files:**
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`

**Step 1: Write the failing behavior test for state transitions**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialSessionState, openTab } from "../src/features/document-tabs/session-model";

test("max 8 tabs", () => {
  let state = createInitialSessionState();
  for (let i = 0; i < 9; i += 1) {
    state = openTab(state, { docId: `d${i}`, title: `Doc ${i}`, now: i + 1, maxTabs: 8 });
  }
  assert.equal(state.tabs.length, 8);
});
```

**Step 2: Run test to verify it fails first**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
Expected: FAIL（新断言未满足）。

**Step 3: Implement DocumentPage integration (minimal)**

实现要点：
1. 新增 `tabSessionState` + `snapshotStore` + `workspaceBridgeMap`。
2. 页面加载/点击树节点时调用 `openTab`。
3. 顶栏点击调用 `activateTab` 并 `navigate('/documents/:id')`。
4. `DocumentWorkspace` 改为按 `docId` keepalive 渲染（非激活隐藏）。

```tsx
{tabState.tabs.map((tab) => (
  <div key={tab.docId} style={{ display: tab.docId === tabState.activeDocId ? "block" : "none", height: "100%" }}>
    <DocumentWorkspace ... onBridgeBind={(bridge) => bindBridge(tab.docId, bridge)} />
  </div>
))}
```

**Step 4: Run tests/build**

Run:
1. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
2. `cd /Users/darin/mine/code/zeus && npm --prefix apps/web run build`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/pages/DocumentPage.tsx apps/web/src/components/DocumentWorkspace.tsx apps/web/src/features/document-tabs/session-model.ts apps/web/tests/document-tabs-session-model.test.ts
git commit -m "feat(web): integrate keepalive document tabs into document page"
```

### Task 6: 补齐淘汰/关闭前 flush 保护与错误处理

**Files:**
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/features/document-tabs/session-model.ts`

**Step 1: Write failing test for flush-guard helper**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { canEvictAfterFlush } from "../src/features/document-tabs/session-model";

test("eviction blocked when flush fails", async () => {
  const result = await canEvictAfterFlush(async () => {
    throw new Error("save failed");
  });
  assert.equal(result.ok, false);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
Expected: FAIL with missing export.

**Step 3: Implement flush guard + UI feedback**

```ts
export async function canEvictAfterFlush(flush: () => Promise<void>) {
  try {
    await flush();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error };
  }
}
```

`DocumentPage` 在淘汰/关闭前调用该 guard：失败则 `message.error("当前文档保存失败，请先处理后再关闭/切换")` 并中断动作。

**Step 4: Run tests/build**

Run:
1. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
2. `cd /Users/darin/mine/code/zeus && npm --prefix apps/web run build`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/pages/DocumentPage.tsx apps/web/src/features/document-tabs/session-model.ts apps/web/tests/document-tabs-session-model.test.ts
git commit -m "feat(web): add flush guard for tab close and lru eviction"
```

### Task 7: 生命周期收尾（项目切换、删除文档、刷新语义）

**Files:**
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Test: `apps/web/tests/document-tabs-session-model.test.ts`

**Step 1: Write failing tests for lifecycle cleanup helpers**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSessionOnProjectSwitch, dropDeletedDocFromSession } from "../src/features/document-tabs/session-model";

test("project switch clears tabs and snapshots", () => {
  const next = clearSessionOnProjectSwitch();
  assert.equal(next.tabs.length, 0);
  assert.equal(next.activeDocId, null);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
Expected: FAIL。

**Step 3: Implement cleanup wiring**

1. 项目切换 effect：清空 tabs/snapshots/bridge map。
2. 文档删除后：从 tabs/snapshots 清理被删 `docId`。
3. 刷新页面后：不恢复旧 tabs（保持会话内语义）。

**Step 4: Run tests/build**

Run:
1. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
2. `cd /Users/darin/mine/code/zeus && npm --prefix apps/web run build`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/pages/DocumentPage.tsx apps/web/src/features/document-tabs/session-model.ts apps/web/tests/document-tabs-session-model.test.ts
git commit -m "feat(web): handle tab lifecycle on project switch and deletion"
```

### Task 8: 回归验证与交付检查

**Files:**
- Modify: `apps/web/tests/document-workspace-autosave.test.ts` (if needed)
- Create: `apps/web/tests/document-tabs-regression-checklist.md`

**Step 1: Add/adjust regression assertions**

覆盖：
1. 切换页签不丢草稿。
2. 重复打开同文档不新增页签。
3. 第 9 个文档触发 LRU 淘汰。

**Step 2: Run full targeted test set**

Run:
1. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-session-model.test.ts`
2. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-tabs-snapshot-store.test.ts`
3. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-workspace-bridge.test.ts`
4. `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/document-workspace-autosave.test.ts`
5. `cd /Users/darin/mine/code/zeus && npm --prefix apps/web run build`
Expected: All PASS。

**Step 3: Commit final verification artifacts**

```bash
git add apps/web/tests/document-tabs-regression-checklist.md apps/web/tests/document-tabs-session-model.test.ts apps/web/tests/document-tabs-snapshot-store.test.ts apps/web/tests/document-workspace-bridge.test.ts
git commit -m "test(web): add multi-tab document regression coverage"
```
