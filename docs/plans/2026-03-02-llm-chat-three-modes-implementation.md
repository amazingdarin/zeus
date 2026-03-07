# LLM 对话三模式实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不破坏现有 `/chat` 的前提下，交付“全页 + 右侧栏 + 弹窗”三模式聊天，并实现“持久会话 + 临时会话 + 转存”混合会话模型与文档块上下文唤起。

**Architecture:** 新增 `ChatRuntimeProvider` 统一管理模式与会话编排；复用并扩展 `useChatLogic` 作为传输核心；将 UI 拆为 `ChatPageShell`、`ChatRightDockShell`、`ChatPopupShell` 三个壳层并共享消息/输入子组件。首期后端采用最小改造，优先复用现有 `chat/runs` 协议。

**Tech Stack:** React 19 + TypeScript + Vite + Ant Design + node:test/tsx + Playwright CLI。

---

### Task 1: 搭建 Chat Runtime 状态骨架（前端）

**Files:**
- Create: `apps/web/src/features/chat-runtime/types.ts`
- Create: `apps/web/src/features/chat-runtime/state.ts`
- Create: `apps/web/src/features/chat-runtime/context.tsx`
- Create: `apps/web/tests/chat-runtime-state.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createChatRuntimeState } from "../src/features/chat-runtime/state";

test("chat runtime initializes with hidden mode and empty transient sessions", () => {
  const state = createChatRuntimeState();
  assert.equal(state.mode, "hidden");
  assert.equal(state.transientSessions.size, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-runtime-state.test.ts`  
Expected: FAIL with module/file not found.

**Step 3: Write minimal implementation**

```ts
export type ChatMode = "page" | "right-dock" | "popup" | "hidden";

export function createChatRuntimeState() {
  return {
    mode: "hidden" as ChatMode,
    transientSessions: new Map<string, unknown>(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-runtime-state.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/chat-runtime/types.ts apps/web/src/features/chat-runtime/state.ts apps/web/src/features/chat-runtime/context.tsx apps/web/tests/chat-runtime-state.test.ts
git commit -m "feat(web): scaffold chat runtime state"
```

### Task 2: 在 AppShell 接入 ChatRuntimeProvider，并移除底部 ChatPanel 挂载

**Files:**
- Modify: `apps/web/src/layout/AppShell.tsx`
- Modify: `apps/web/src/App.css`
- Test: `apps/web/tests/chat-runtime-layout.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { shouldRenderBottomChatPanel } from "../src/features/chat-runtime/state";

test("bottom chat panel is disabled after runtime migration", () => {
  assert.equal(shouldRenderBottomChatPanel("/documents"), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-runtime-layout.test.ts`  
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export function shouldRenderBottomChatPanel(_pathname: string): boolean {
  return false;
}
```

并在 `AppShell` 删除：

```tsx
{!isChatPage && <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />}
```

替换为后续 Runtime 容器挂载位。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-runtime-layout.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/layout/AppShell.tsx apps/web/src/App.css apps/web/tests/chat-runtime-layout.test.ts apps/web/src/features/chat-runtime/state.ts
git commit -m "refactor(web): remove bottom chat panel mount"
```

### Task 3: 抽取共享聊天展示组件（消息区 + 输入区）

**Files:**
- Create: `apps/web/src/components/chat/ChatConversationView.tsx`
- Create: `apps/web/src/components/chat/ChatInputBar.tsx`
- Modify: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/pages/ChatPage.tsx`
- Test: `apps/web/tests/chat-shared-components.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mapChatViewProps } from "../src/components/chat/ChatConversationView";

test("chat conversation view mapper keeps assistant markdown flag", () => {
  const out = mapChatViewProps({ role: "assistant", content: "**ok**" });
  assert.equal(out.renderAsMarkdown, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-shared-components.test.ts`  
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```ts
export function mapChatViewProps(msg: { role: "user" | "assistant" | "system"; content: string }) {
  return {
    text: msg.content,
    renderAsMarkdown: msg.role === "assistant",
  };
}
```

并将 `ChatPanel`/`ChatPage` 内重复渲染块替换为共享组件调用。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-shared-components.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat/ChatConversationView.tsx apps/web/src/components/chat/ChatInputBar.tsx apps/web/src/components/ChatPanel.tsx apps/web/src/pages/ChatPage.tsx apps/web/tests/chat-shared-components.test.ts
git commit -m "refactor(web): extract shared chat conversation and input components"
```

### Task 4: 实现右侧栏聊天壳层并在非 /chat 页面启用

**Files:**
- Create: `apps/web/src/components/chat/ChatRightDockShell.tsx`
- Modify: `apps/web/src/layout/AppShell.tsx`
- Modify: `apps/web/src/App.css`
- Test: `apps/web/tests/chat-right-dock-shell.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveRightDockVisible } from "../src/features/chat-runtime/state";

test("right dock hidden on /chat and visible on /documents", () => {
  assert.equal(resolveRightDockVisible("/chat"), false);
  assert.equal(resolveRightDockVisible("/documents"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-right-dock-shell.test.ts`  
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export function resolveRightDockVisible(pathname: string): boolean {
  return pathname !== "/chat";
}
```

并在 `AppShell` 挂载 `ChatRightDockShell`，使用 runtime 状态控制显示与折叠。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-right-dock-shell.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat/ChatRightDockShell.tsx apps/web/src/layout/AppShell.tsx apps/web/src/App.css apps/web/tests/chat-right-dock-shell.test.ts apps/web/src/features/chat-runtime/state.ts
git commit -m "feat(web): add right dock chat shell"
```

### Task 5: 实现弹窗聊天壳层与统一打开接口

**Files:**
- Create: `apps/web/src/components/chat/ChatPopupShell.tsx`
- Modify: `apps/web/src/features/chat-runtime/context.tsx`
- Modify: `apps/web/src/layout/AppShell.tsx`
- Test: `apps/web/tests/chat-popup-shell.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createChatRuntimeState } from "../src/features/chat-runtime/state";

test("openPopup sets popup mode and stores invocation context", () => {
  const state = createChatRuntimeState();
  state.openPopup({ source: "doc-block", projectRef: "personal::me::p1" });
  assert.equal(state.mode, "popup");
  assert.equal(state.popup?.source, "doc-block");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-popup-shell.test.ts`  
Expected: FAIL with `openPopup` not defined.

**Step 3: Write minimal implementation**

```ts
openPopup(context) {
  this.mode = "popup";
  this.popup = { ...context, open: true };
}
```

并在 `AppShell` 全局挂载 `ChatPopupShell`（Ant Modal/自定义遮罩均可，优先最小侵入）。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-popup-shell.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat/ChatPopupShell.tsx apps/web/src/features/chat-runtime/context.tsx apps/web/src/layout/AppShell.tsx apps/web/tests/chat-popup-shell.test.ts apps/web/src/features/chat-runtime/state.ts
git commit -m "feat(web): add popup chat shell and runtime open API"
```

### Task 6: 扩展聊天上下文注入协议并接入 `createChatRun`

**Files:**
- Modify: `apps/web/src/api/chat.ts`
- Modify: `apps/web/src/hooks/useChatLogic.tsx`
- Create: `apps/web/tests/chat-invocation-context.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildChatMessageWithContext } from "../src/hooks/useChatLogic";

test("buildChatMessageWithContext prefixes doc-block context", () => {
  const msg = buildChatMessageWithContext("请优化", {
    source: "doc-block",
    projectRef: "personal::me::p1",
    document: { docId: "d1", blockId: "b1" },
  });
  assert.match(msg, /doc-block/);
  assert.match(msg, /d1/);
  assert.match(msg, /b1/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-invocation-context.test.ts`  
Expected: FAIL with missing helper.

**Step 3: Write minimal implementation**

```ts
export function buildChatMessageWithContext(message: string, context?: ChatInvocationContext): string {
  if (!context) return message;
  const prefix = `[context] source=${context.source} doc=${context.document?.docId ?? ""} block=${context.document?.blockId ?? ""}`;
  return `${prefix}\n${message}`;
}
```

并在 `createChatRun` 调用前统一使用该方法处理发送文本。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-invocation-context.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/api/chat.ts apps/web/src/hooks/useChatLogic.tsx apps/web/tests/chat-invocation-context.test.ts
git commit -m "feat(web): support invocation context injection for chat runs"
```

### Task 7: 实现“临时会话 -> 持久会话”转存链路

**Files:**
- Modify: `apps/web/src/features/chat-runtime/state.ts`
- Modify: `apps/web/src/api/chat-sessions.ts`
- Modify: `apps/web/src/components/chat/ChatRightDockShell.tsx`
- Modify: `apps/web/src/components/chat/ChatPopupShell.tsx`
- Create: `apps/web/tests/chat-transient-transfer.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createChatRuntimeState } from "../src/features/chat-runtime/state";

test("transferTransientToChat returns new persistent session id", async () => {
  const state = createChatRuntimeState();
  state.seedTransient("tmp-1", [{ role: "user", content: "hello" }]);
  const sessionId = await state.transferTransientToChat("tmp-1");
  assert.ok(sessionId.startsWith("session-"));
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/chat-transient-transfer.test.ts`  
Expected: FAIL with method not found.

**Step 3: Write minimal implementation**

```ts
async transferTransientToChat(transientId: string): Promise<string> {
  const session = await createSession(this.projectRef);
  // TODO: replay messages with existing APIs; keep minimal first pass.
  this.transientSessions.delete(transientId);
  return session.id;
}
```

并在右侧栏/弹窗头部提供“转存到 AI 助手”按钮。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/chat-transient-transfer.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/chat-runtime/state.ts apps/web/src/api/chat-sessions.ts apps/web/src/components/chat/ChatRightDockShell.tsx apps/web/src/components/chat/ChatPopupShell.tsx apps/web/tests/chat-transient-transfer.test.ts
git commit -m "feat(web): add transient chat transfer to persistent session"
```

### Task 8: 在文档编辑器接入“文档块唤起弹窗对话”

**Files:**
- Modify: `packages/doc-editor/src/ui/block-add-menu.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `apps/web/src/components/RichTextEditor.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Create: `apps/web/tests/doc-block-chat-trigger.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { hasAiChatSlashItem } from "../../packages/doc-editor/src/ui/block-add-menu";

test("block slash menu contains AI chat trigger item", () => {
  assert.equal(hasAiChatSlashItem(), true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/doc-block-chat-trigger.test.ts`  
Expected: FAIL with helper not found / item absent.

**Step 3: Write minimal implementation**

```ts
// block-add-menu.tsx
{ kind: "builtin", id: "ai-chat", label: "AI 对话", icon: <MessageOutlined /> }
```

在 `doc-editor.tsx` 为该项新增 `onAiChatTrigger({ blockId, selectionText })` 回调；
在 `RichTextEditor` 向上透传到 `DocumentPage`；
在 `DocumentPage` 调用 `openPopup(context)`。

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/doc-block-chat-trigger.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/ui/block-add-menu.tsx packages/doc-editor/src/templates/simple/doc-editor.tsx apps/web/src/components/RichTextEditor.tsx apps/web/src/pages/DocumentPage.tsx apps/web/tests/doc-block-chat-trigger.test.ts
git commit -m "feat(doc): add block-level AI chat popup trigger"
```

### Task 9: 完成回归验证（单测 + Playwright）并补充文档

**Files:**
- Modify: `docs/plans/2026-03-02-llm-chat-three-modes-implementation.md`
- Create: `output/playwright/chat-three-modes-regression.js`
- Create: `output/playwright/chat-three-modes-regression.md`

**Step 1: Write the failing/guard test cases list**

在 `output/playwright/chat-three-modes-regression.js` 编写以下流程：
1. 文档页右侧栏可打开并发送消息。
2. 右侧栏折叠/展开状态可恢复。
3. 文档块触发弹窗，包含 doc/block 上下文标签。
4. 弹窗转存成功并跳转 `/chat` 会话。

**Step 2: Run browser test and capture failures**

Run: `playwright-cli run output/playwright/chat-three-modes-regression.js`  
Expected: 首轮至少 1 个断言失败（在功能未补齐前）。

**Step 3: Fix minimal gaps and rerun**

按失败点逐条修复后再次执行脚本。

**Step 4: Run full verification**

Run: `node --import tsx --test apps/web/tests/chat-runtime-state.test.ts apps/web/tests/chat-runtime-layout.test.ts apps/web/tests/chat-shared-components.test.ts apps/web/tests/chat-right-dock-shell.test.ts apps/web/tests/chat-popup-shell.test.ts apps/web/tests/chat-invocation-context.test.ts apps/web/tests/chat-transient-transfer.test.ts apps/web/tests/doc-block-chat-trigger.test.ts`  
Expected: PASS。

Run: `npm run test:unified-editor`  
Expected: PASS（确保编辑器改动无回归）。

Run: `playwright-cli run output/playwright/chat-three-modes-regression.js`  
Expected: PASS，报告输出到 `output/playwright/chat-three-modes-regression.md`。

**Step 5: Commit**

```bash
git add output/playwright/chat-three-modes-regression.js output/playwright/chat-three-modes-regression.md docs/plans/2026-03-02-llm-chat-three-modes-implementation.md
git commit -m "test(web): add three-mode chat regression coverage"
```

## Execution Notes

1. 强制流程：遵循 `@test-driven-development`，每个任务先写失败测试再实现。
2. 遇到异常：先按 `@systematic-debugging` 走最小复现和根因确认。
3. 完成前：执行 `@verification-before-completion` 的全量验证。
4. 自动化验证：前端改动必须运行 `@playwright`（使用项目固定测试账号）。
5. 提交策略：小步提交，保持每个任务一个可回滚 commit。
