# Block Menu Text Conversion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在块菜单中实现文本基础块互相转化，支持 `Cmd+/`/`Alt+/` 打开菜单后将当前块转换为目标文本块，并保留文本与行内格式。

**Architecture:** 在 `doc-editor` 内引入“块类型识别 + 目标类型过滤 + 内容转换”的纯函数模块，`DocEditor` 仅负责菜单状态与事务调度。转换动作统一走 `handleConvertCurrentBlock(targetType)`，通过顶层块定位后做原子替换，保证拖拽、删除、`/` 菜单能力不受影响。

**Tech Stack:** React 19, Tiptap 3, TypeScript, Node test runner (`node --import tsx --test`), SCSS

---

Skills to apply during implementation: `@superpowers:test-driven-development`, `@superpowers:verification-before-completion`.

### Task 1: Add Block Conversion Core (Pure Functions)

**Files:**
- Create: `packages/doc-editor/src/extensions/block-conversion.ts`
- Test: `packages/doc-editor/tests/block-conversion.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  resolveCurrentBlockConvertType,
  getConvertibleTargetTypes,
} from "../src/extensions/block-conversion"

test("resolveCurrentBlockConvertType maps heading attrs", () => {
  const type = resolveCurrentBlockConvertType({
    name: "heading",
    attrs: { level: 1, collapsible: true },
  })
  assert.equal(type, "collapsible-heading-1")
})

test("getConvertibleTargetTypes excludes current type", () => {
  const targets = getConvertibleTargetTypes("heading-1")
  assert.equal(targets.includes("heading-1"), false)
  assert.equal(targets.includes("heading-2"), true)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
Expected: FAIL with module/function-not-found errors.

**Step 3: Write minimal implementation**

```ts
export type ConvertibleTextBlockType =
  | "paragraph"
  | "heading-1"
  | "collapsible-heading-1"
  | "heading-2"
  | "collapsible-heading-2"
  | "heading-3"
  | "collapsible-heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"

export function resolveCurrentBlockConvertType(node: {
  name: string
  attrs?: Record<string, unknown>
}): ConvertibleTextBlockType | null {
  // map heading/list/paragraph/code/blockquote to convertible type
  return null
}

export function getConvertibleTargetTypes(
  current: ConvertibleTextBlockType
): ConvertibleTextBlockType[] {
  // return all supported types except current
  return []
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-conversion.ts packages/doc-editor/tests/block-conversion.test.ts
git commit -m "feat(doc-editor): add block conversion type mapping core"
```

### Task 2: Implement Content Conversion Rules (Preserve + Safe Degrade)

**Files:**
- Modify: `packages/doc-editor/src/extensions/block-conversion.ts`
- Test: `packages/doc-editor/tests/block-conversion.test.ts`

**Step 1: Write the failing test**

```ts
test("list to paragraph merges lines with newline", () => {
  const output = convertTopLevelBlockContent({
    sourceType: "bullet-list",
    targetType: "paragraph",
    lines: ["A", "B"],
  })
  assert.equal(output.type, "paragraph")
  assert.equal(output.text, "A\nB")
})

test("paragraph multi-line to ordered list splits items", () => {
  const output = convertTopLevelBlockContent({
    sourceType: "paragraph",
    targetType: "ordered-list",
    text: "A\nB",
  })
  assert.equal(output.type, "ordered-list")
  assert.deepEqual(output.items, ["A", "B"])
})

test("heading-1 to collapsible-heading-1 keeps text and marks", () => {
  const output = convertTopLevelBlockContent({
    sourceType: "heading-1",
    targetType: "collapsible-heading-1",
    text: "Title",
    marks: [{ type: "bold" }],
  })
  assert.equal(output.attrs?.collapsible, true)
  assert.equal(output.text, "Title")
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
Expected: FAIL on missing conversion function/logic.

**Step 3: Write minimal implementation**

```ts
export function convertTopLevelBlockContent(input: {
  sourceType: ConvertibleTextBlockType
  targetType: ConvertibleTextBlockType
  text?: string
  lines?: string[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}) {
  // 1) normalize source to text + lines
  // 2) if target is list: split by newline to items
  // 3) if target is single block: join lines with "\n"
  // 4) preserve marks when target allows marks; degrade to plain text for code-block
  return {}
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-conversion.ts packages/doc-editor/tests/block-conversion.test.ts
git commit -m "feat(doc-editor): implement text block conversion rules"
```

### Task 3: Wire Conversion Action Into DocEditor

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.scss`

**Step 1: Write the failing test**

```ts
// add pure helper exports from doc-editor.tsx or a small helper module:
// resolveCurrentBlockMenuActions(currentType)
// expected to include convert targets and delete action.

test("block action menu includes convert targets without current type", () => {
  const actions = resolveCurrentBlockMenuActions("heading-1")
  assert.equal(actions.some((item) => item.id === "convert:heading-1"), false)
  assert.equal(actions.some((item) => item.id === "convert:paragraph"), true)
  assert.equal(actions.some((item) => item.id === "delete"), true)
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
Expected: FAIL for missing menu action helper.

**Step 3: Write minimal implementation**

```ts
const currentConvertibleType = resolveCurrentBlockConvertType(currentNode)
const convertTargets = currentConvertibleType
  ? getConvertibleTargetTypes(currentConvertibleType)
  : []

const handleConvertCurrentBlock = useCallback((targetType) => {
  // locate top-level block by currentBlockId
  // convert source node -> target node json
  // replace source range atomically
  // close menus + updateBlockHandlePosition
}, [editor, currentBlockId])
```

```scss
.doc-editor-block-action-menu-submenu {
  /* nested convert target list style */
}
```

**Step 4: Run tests to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/templates/simple/doc-editor.scss packages/doc-editor/tests/block-conversion.test.ts
git commit -m "feat(doc-editor): add convert submenu and conversion action"
```

### Task 4: Keep Shortcut and Menu Behavior Stable

**Files:**
- Modify: `packages/doc-editor/src/extensions/block-add-handle.ts`
- Modify: `packages/doc-editor/tests/block-add-handle.test.ts`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`

**Step 1: Write the failing test**

```ts
test("command+/ and alt+/ still open block action menu", () => {
  assert.equal(
    isBlockActionMenuShortcut({ key: "/", code: "Slash", metaKey: true, altKey: false, ctrlKey: false }),
    true
  )
  assert.equal(
    isBlockActionMenuShortcut({ key: "÷", code: "Slash", metaKey: false, altKey: true, ctrlKey: false }),
    true
  )
})
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`
Expected: FAIL when behavior regresses.

**Step 3: Write minimal implementation**

```ts
if (isBlockActionMenuShortcut(...) && inEditorContent) {
  // toggle action menu, close slash/add menu
}
```

**Step 4: Run tests to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-add-handle.ts packages/doc-editor/tests/block-add-handle.test.ts packages/doc-editor/src/templates/simple/doc-editor.tsx
git commit -m "test(doc-editor): lock block action menu shortcut behavior"
```

### Task 5: Full Verification and Regression Coverage

**Files:**
- Modify: `package.json` (only if adding new test file to unified script)
- Test: `packages/doc-editor/tests/block-conversion.test.ts`
- Test: `packages/doc-editor/tests/block-add-handle.test.ts`

**Step 1: Write/extend failing end-to-end regression assertions**

```ts
// extend block-conversion tests for:
// - list -> heading keeps newline
// - code-block -> paragraph keeps text
// - collapsible-heading -> heading keeps level and text
```

**Step 2: Run targeted tests first**

Run:
`node --import tsx --test packages/doc-editor/tests/block-conversion.test.ts packages/doc-editor/tests/block-add-handle.test.ts`
Expected: PASS.

**Step 3: Run unified editor suite**

Run:
`npm run test:unified-editor`
Expected: all pass, no regression in existing editor behavior.

**Step 4: Optional UI smoke check**

Run (manual or playwright-cli):
- 打开文档页
- `Cmd+/` 打开块菜单
- 选择“转换为 -> 目标块”验证当前块被替换
- 再验证“删除块”仍可用

Expected: 行为与设计一致。

**Step 5: Commit**

```bash
git add packages/doc-editor/tests/block-conversion.test.ts package.json
git commit -m "test(doc-editor): add conversion regression coverage"
```

---

## Final Verification Checklist

1. `Cmd+/` 与 `Alt+/` 可稳定打开块菜单。
2. 块菜单存在“转换为”二级菜单。
3. 当前同类型目标不显示。
4. 列表/代码块转单块时合并为单块并保留换行。
5. 文本与行内 marks 在兼容目标中保留，代码块等场景安全降级。
6. `删除块` 仍可正常工作。

## Risk Notes

1. `code-block` marks 处理边界：需确认降级路径不会抛异常。
2. 深度嵌套列表：本次按顶层文本转换，不保留嵌套结构。
3. 光标恢复位置：转换后需统一 `focus` 到目标块起始位置，避免 UX 跳动。

