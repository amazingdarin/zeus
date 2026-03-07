# 文档块级背景色与字体色 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为文本类块提供“块背景色 + 块级字体色”能力，使用受控预设色板，支持设置与清除，并保证保存后可恢复。

**Architecture:** 在 `@zeus/doc-editor` 内通过块级扩展为目标节点注入 `backgroundColor` 与 `textColor` 属性，命令层只接受白名单 token。交互入口放在块操作菜单（`⋮⋮`）中，编辑器状态变更复用既有 `onChange -> 保存` 链路。OpenSpec 同步补充属性定义与 JSON 示例。

**Tech Stack:** TypeScript, React, TipTap 3, Node test runner (`node --import tsx --test`), SCSS

---

实施时请全程遵循：@superpowers:test-driven-development、@superpowers:verification-before-completion。  
如需页面级回归，使用：@playwright。

### Task 1: 建立块样式色板与白名单校验

**Files:**
- Create: `packages/doc-editor/src/extensions/block-style-palette.ts`
- Create: `packages/doc-editor/tests/block-style-palette.test.ts`
- Modify: `package.json`（把新测试加入 `test:unified-editor`）

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  BLOCK_BACKGROUND_COLOR_VALUES,
  BLOCK_TEXT_COLOR_VALUES,
  isAllowedBlockBackgroundColor,
  isAllowedBlockTextColor,
} from "../src/extensions/block-style-palette"

test("block style palette allows predefined values only", () => {
  assert.equal(BLOCK_BACKGROUND_COLOR_VALUES.length > 0, true)
  assert.equal(BLOCK_TEXT_COLOR_VALUES.length > 0, true)
  assert.equal(isAllowedBlockBackgroundColor("var(--tt-color-highlight-blue)"), true)
  assert.equal(isAllowedBlockBackgroundColor("#ff0000"), false)
  assert.equal(isAllowedBlockTextColor("var(--tt-color-text-red)"), true)
  assert.equal(isAllowedBlockTextColor("rgb(1,2,3)"), false)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-style-palette.test.ts`  
Expected: FAIL（模块不存在或断言失败）

**Step 3: Write minimal implementation**

```ts
export const BLOCK_BACKGROUND_COLOR_VALUES = [
  "var(--tt-color-highlight-gray)",
  "var(--tt-color-highlight-brown)",
  "var(--tt-color-highlight-orange)",
  "var(--tt-color-highlight-yellow)",
  "var(--tt-color-highlight-green)",
  "var(--tt-color-highlight-blue)",
  "var(--tt-color-highlight-purple)",
  "var(--tt-color-highlight-pink)",
  "var(--tt-color-highlight-red)",
] as const

export const BLOCK_TEXT_COLOR_VALUES = [
  "var(--tt-color-text-gray)",
  "var(--tt-color-text-brown)",
  "var(--tt-color-text-orange)",
  "var(--tt-color-text-yellow)",
  "var(--tt-color-text-green)",
  "var(--tt-color-text-blue)",
  "var(--tt-color-text-purple)",
  "var(--tt-color-text-pink)",
  "var(--tt-color-text-red)",
] as const

const backgroundSet = new Set(BLOCK_BACKGROUND_COLOR_VALUES)
const textSet = new Set(BLOCK_TEXT_COLOR_VALUES)

export const isAllowedBlockBackgroundColor = (value?: string | null) =>
  typeof value === "string" && backgroundSet.has(value as (typeof BLOCK_BACKGROUND_COLOR_VALUES)[number])

export const isAllowedBlockTextColor = (value?: string | null) =>
  typeof value === "string" && textSet.has(value as (typeof BLOCK_TEXT_COLOR_VALUES)[number])
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-style-palette.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add package.json packages/doc-editor/src/extensions/block-style-palette.ts packages/doc-editor/tests/block-style-palette.test.ts
git commit -m "test: add block style palette allowlist coverage"
```

### Task 2: 扩展块样式命令（背景色 + 字体色）

**Files:**
- Modify: `packages/doc-editor/src/extensions/node-background-extension.ts`
- Modify: `packages/doc-editor/src/extensions/index.ts`
- Create: `packages/doc-editor/tests/block-style-extension.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  resolveBlockStyleColorInput,
} from "../src/extensions/node-background-extension"

test("resolveBlockStyleColorInput rejects non-allowlist values", () => {
  assert.equal(resolveBlockStyleColorInput("background", "var(--tt-color-highlight-green)"), "var(--tt-color-highlight-green)")
  assert.equal(resolveBlockStyleColorInput("background", "#00ff00"), null)
  assert.equal(resolveBlockStyleColorInput("text", "var(--tt-color-text-blue)"), "var(--tt-color-text-blue)")
  assert.equal(resolveBlockStyleColorInput("text", "blue"), null)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-style-extension.test.ts`  
Expected: FAIL（方法未导出/行为不匹配）

**Step 3: Write minimal implementation**

```ts
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    nodeBackground: {
      setNodeBackgroundColor: (backgroundColor: string) => ReturnType
      unsetNodeBackgroundColor: () => ReturnType
      toggleNodeBackgroundColor: (backgroundColor: string) => ReturnType
      setNodeTextColor: (textColor: string) => ReturnType
      unsetNodeTextColor: () => ReturnType
      toggleNodeTextColor: (textColor: string) => ReturnType
    }
  }
}

export function resolveBlockStyleColorInput(
  kind: "background" | "text",
  input: string | null | undefined
): string | null {
  if (!input) return null
  if (kind === "background") return isAllowedBlockBackgroundColor(input) ? input : null
  return isAllowedBlockTextColor(input) ? input : null
}

// addGlobalAttributes: add both attrs
// renderHTML: output style background-color/color if value is allowlisted
// commands: set/unset/toggle for backgroundColor and textColor
```

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test packages/doc-editor/tests/block-style-extension.test.ts`
- `node --import tsx --test packages/doc-editor/tests/block-style-palette.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/node-background-extension.ts packages/doc-editor/src/extensions/index.ts packages/doc-editor/tests/block-style-extension.test.ts
git commit -m "feat: extend node block style commands with text color"
```

### Task 3: 在编辑器中注册块样式扩展并定义目标节点

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/extensions/BlockIdExtension.ts`（如需补齐节点集合一致性）

**Step 1: Write the failing test**

新增轻量断言测试（检查扩展列表配置函数）：

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { getDocEditorBlockStyleTypes } from "../src/templates/simple/doc-editor"

test("doc editor block style types include text-like blocks only", () => {
  const types = getDocEditorBlockStyleTypes()
  assert.equal(types.includes("paragraph"), true)
  assert.equal(types.includes("heading"), true)
  assert.equal(types.includes("image"), false)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-style-extension.test.ts`  
Expected: FAIL（函数未导出或断言失败）

**Step 3: Write minimal implementation**

```ts
export const DOC_EDITOR_BLOCK_STYLE_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
] as const

export function getDocEditorBlockStyleTypes() {
  return [...DOC_EDITOR_BLOCK_STYLE_TYPES]
}

// in extensions array:
NodeBackground.configure({ types: getDocEditorBlockStyleTypes() })
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-style-extension.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/extensions/BlockIdExtension.ts packages/doc-editor/tests/block-style-extension.test.ts
git commit -m "feat: register block style extension in doc editor"
```

### Task 4: 块菜单新增“块背景色/块文字色”交互

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.scss`
- Create: `packages/doc-editor/src/ui/block-style-menu.tsx`
- Modify: `packages/doc-editor/src/ui/index.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { buildBlockStyleMenuState } from "../src/ui/block-style-menu"

test("buildBlockStyleMenuState returns mixed when multiple values selected", () => {
  const state = buildBlockStyleMenuState(["var(--tt-color-text-blue)", "var(--tt-color-text-red)"])
  assert.equal(state.kind, "mixed")
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-style-extension.test.ts`  
Expected: FAIL（函数未实现）

**Step 3: Write minimal implementation**

```ts
export function buildBlockStyleMenuState(values: Array<string | null | undefined>) {
  const normalized = Array.from(new Set(values.filter(Boolean)))
  if (normalized.length === 0) return { kind: "empty" as const }
  if (normalized.length === 1) return { kind: "single" as const, value: normalized[0] as string }
  return { kind: "mixed" as const }
}

// DocEditor block action menu:
// - add submenu "块背景色" with swatches + clear
// - add submenu "块文字色" with swatches + clear
// - call chain().focus().setNodeBackgroundColor(color).run()
// - call chain().focus().setNodeTextColor(color).run()
```

**Step 4: Run tests + quick regression**

Run:
- `node --import tsx --test packages/doc-editor/tests/block-style-extension.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/templates/simple/doc-editor.scss packages/doc-editor/src/ui/block-style-menu.tsx packages/doc-editor/src/ui/index.ts packages/doc-editor/tests/block-style-extension.test.ts
git commit -m "feat: add block style color menus in block action panel"
```

### Task 5: 保证块转换与复制链路保留样式属性

**Files:**
- Modify: `packages/doc-editor/src/extensions/block-conversion.ts`
- Modify: `packages/doc-editor/src/extensions/block-duplicate.ts`
- Modify: `packages/doc-editor/tests/block-conversion.test.ts`
- Modify: `packages/doc-editor/tests/block-duplicate.test.ts`

**Step 1: Write the failing test**

在现有测试新增断言：

```ts
test("duplicate keeps block style attrs except id", () => {
  // source attrs: { id: "p1", backgroundColor: "...", textColor: "..." }
  // expect clone attrs: { backgroundColor: "...", textColor: "...", id: undefined }
})

test("conversion preserves block style attrs when target supports them", () => {
  // paragraph -> heading keeps backgroundColor/textColor
})
```

**Step 2: Run test to verify it fails**

Run:
- `node --import tsx --test packages/doc-editor/tests/block-duplicate.test.ts`
- `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

```ts
const BLOCK_STYLE_ATTR_KEYS = ["backgroundColor", "textColor"] as const

function pickBlockStyleAttrs(attrs?: Record<string, unknown>) {
  return BLOCK_STYLE_ATTR_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    const value = attrs?.[key]
    if (value != null) acc[key] = value
    return acc
  }, {})
}

// conversion target attrs merge:
// { ...existingTargetAttrs, ...pickBlockStyleAttrs(source.attrs) }
```

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test packages/doc-editor/tests/block-duplicate.test.ts`
- `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-conversion.ts packages/doc-editor/src/extensions/block-duplicate.ts packages/doc-editor/tests/block-conversion.test.ts packages/doc-editor/tests/block-duplicate.test.ts
git commit -m "fix: preserve block style attrs across conversion and duplicate"
```

### Task 6: 更新文档格式规范（OpenSpec）

**Files:**
- Modify: `openspec/specs/document-format/specs/block-types.spec.md`
- Modify: `openspec/specs/document-format/specs/document-structure.spec.md`（如需同步枚举）

**Step 1: Write the failing test**

使用规范一致性检查（先手工断言）：

```bash
rg -n "backgroundColor|textColor" openspec/specs/document-format/specs/block-types.spec.md
```

Expected: 无结果（视为失败前置）

**Step 2: Run check to verify it fails**

Run: `rg -n "backgroundColor|textColor" openspec/specs/document-format/specs/block-types.spec.md`  
Expected: no match

**Step 3: Write minimal implementation**

在相关块类型属性表加入：

```md
| `backgroundColor` | `string` | 否 | `null` | 块背景色（仅预设 token） |
| `textColor` | `string` | 否 | `null` | 块级文本颜色（仅预设 token） |
```

并补充一段 JSON 示例。

**Step 4: Run check to verify it passes**

Run: `rg -n "backgroundColor|textColor" openspec/specs/document-format/specs/block-types.spec.md`  
Expected: 匹配到新增内容

**Step 5: Commit**

```bash
git add openspec/specs/document-format/specs/block-types.spec.md openspec/specs/document-format/specs/document-structure.spec.md
git commit -m "docs: document block style attrs in openspec"
```

### Task 7: 端到端回归与收尾

**Files:**
- Modify: `AGENTS.md`（若需追加本功能验收命令说明）
- Create: `output/playwright/block-style-regression.md`（记录一次回归结果，可选）

**Step 1: Write the failing test**

定义回归脚本（手工步骤先记录）：

```md
1. 打开文档并选中段落块
2. 设置背景色与文字色
3. 刷新页面并确认样式仍在
4. 切换到另一文档再切回，确认样式仍在
5. 清除样式并确认恢复默认
```

**Step 2: Run test to verify it fails**

Run: `playwright-cli`（按上述步骤执行）  
Expected: 在功能未完备前至少 1 条失败

**Step 3: Write minimal implementation**

根据失败点修正（通常在 `doc-editor.tsx` 命令触发或 menu state 读取）。

**Step 4: Run test to verify it passes**

Run:
- `npm run test:unified-editor`
- `playwright-cli`（同一路径复测）

Expected: 全部通过

**Step 5: Commit**

```bash
git add AGENTS.md output/playwright/block-style-regression.md
git commit -m "test: add regression evidence for block style color flow"
```

