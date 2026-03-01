import type { JSONContent } from "@tiptap/react"

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

const CONVERTIBLE_TEXT_BLOCK_TYPES: ConvertibleTextBlockType[] = [
  "paragraph",
  "heading-1",
  "collapsible-heading-1",
  "heading-2",
  "collapsible-heading-2",
  "heading-3",
  "collapsible-heading-3",
  "bullet-list",
  "ordered-list",
  "task-list",
  "blockquote",
  "code-block",
]

function cloneNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeNodeType(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeLevel(value: unknown): 1 | 2 | 3 {
  const level = Number(value)
  if (level === 2 || level === 3) {
    return level
  }
  return 1
}

function normalizeBlockId(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function normalizeStyleColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized || null
}

type BlockStyleAttrs = Partial<
  Record<"backgroundColor" | "textColor", string>
>

function pickBlockStyleAttrs(
  attrs: Record<string, unknown> | undefined
): BlockStyleAttrs {
  const backgroundColor = normalizeStyleColor(attrs?.backgroundColor)
  const textColor = normalizeStyleColor(attrs?.textColor)
  const next: BlockStyleAttrs = {}
  if (backgroundColor) {
    next.backgroundColor = backgroundColor
  }
  if (textColor) {
    next.textColor = textColor
  }
  return next
}

function withOptionalId(
  attrs: Record<string, unknown> | undefined,
  id: string | null,
  blockStyleAttrs?: BlockStyleAttrs
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {
    ...(attrs ?? {}),
    ...(blockStyleAttrs ?? {}),
  }

  if (id) {
    merged.id = id
  }

  if (Object.keys(merged).length === 0) {
    return undefined
  }

  return merged
}

function splitInlineContentByLine(
  content: JSONContent[] | undefined
): JSONContent[][] {
  const lines: JSONContent[][] = [[]]
  const source = Array.isArray(content) ? content : []

  for (const rawNode of source) {
    const node = cloneNode(rawNode)
    if (node.type === "hardBreak") {
      lines.push([])
      continue
    }
    if (node.type === "text" && typeof node.text === "string") {
      const segments = node.text.split("\n")
      segments.forEach((segment, index) => {
        if (segment.length > 0) {
          lines[lines.length - 1].push({
            ...node,
            text: segment,
          })
        }
        if (index < segments.length - 1) {
          lines.push([])
        }
      })
      continue
    }
    lines[lines.length - 1].push(node)
  }

  if (lines.length === 0) {
    return [[]]
  }
  return lines
}

function joinInlineLines(lines: JSONContent[][]): JSONContent[] {
  const merged: JSONContent[] = []
  lines.forEach((line, index) => {
    if (index > 0) {
      merged.push({ type: "hardBreak" })
    }
    for (const node of line) {
      merged.push(cloneNode(node))
    }
  })
  return merged
}

function extractPlainTextFromInline(content: JSONContent[] | undefined): string {
  const source = Array.isArray(content) ? content : []
  let text = ""
  for (const node of source) {
    if (node.type === "text" && typeof node.text === "string") {
      text += node.text
      continue
    }
    if (node.type === "hardBreak") {
      text += "\n"
      continue
    }
    if (Array.isArray(node.content)) {
      text += extractPlainTextFromInline(node.content)
    }
  }
  return text
}

function lineToPlainText(line: JSONContent[]): string {
  let text = ""
  for (const node of line) {
    if (node.type === "text" && typeof node.text === "string") {
      text += node.text
      continue
    }
    if (node.type === "hardBreak") {
      text += "\n"
      continue
    }
    if (Array.isArray(node.content)) {
      text += extractPlainTextFromInline(node.content)
    }
  }
  return text
}

function textToInlineLines(text: string): JSONContent[][] {
  const normalized = String(text ?? "")
  const rawLines = normalized.split("\n")
  if (rawLines.length === 0) {
    return [[]]
  }
  return rawLines.map((line) =>
    line.length > 0 ? [{ type: "text", text: line }] : []
  )
}

function mergeLinesAsSingleItem(lines: JSONContent[][]): JSONContent[] {
  if (lines.length === 0) {
    return []
  }
  return joinInlineLines(lines)
}

function getListItemsFromListNode(node: JSONContent): JSONContent[][] {
  const content = Array.isArray(node.content) ? node.content : []
  const items: JSONContent[][] = []

  for (const child of content) {
    const childType = normalizeNodeType(child.type)
    if (childType !== "listItem" && childType !== "taskItem") {
      continue
    }
    const itemContent = Array.isArray(child.content) ? child.content : []
    const itemLines: JSONContent[][] = []

    for (const itemChild of itemContent) {
      const itemChildType = normalizeNodeType(itemChild.type)
      if (itemChildType === "paragraph" || itemChildType === "heading") {
        const lines = splitInlineContentByLine(itemChild.content)
        itemLines.push(...lines)
        continue
      }
      const plain = extractPlainTextFromInline(itemChild.content)
      const lines = textToInlineLines(plain)
      itemLines.push(...lines)
    }

    items.push(mergeLinesAsSingleItem(itemLines))
  }

  if (items.length === 0) {
    return [[]]
  }
  return items
}

function extractLinesForSingleTarget(source: JSONContent): JSONContent[][] {
  const sourceType = resolveCurrentBlockConvertType(source)
  if (
    sourceType === "bullet-list" ||
    sourceType === "ordered-list" ||
    sourceType === "task-list"
  ) {
    return getListItemsFromListNode(source)
  }
  if (normalizeNodeType(source.type) === "blockquote") {
    const blocks = Array.isArray(source.content) ? source.content : []
    const lines: JSONContent[][] = []
    for (const block of blocks) {
      const blockType = normalizeNodeType(block.type)
      if (blockType === "paragraph" || blockType === "heading") {
        lines.push(...splitInlineContentByLine(block.content))
      } else {
        lines.push(...textToInlineLines(extractPlainTextFromInline(block.content)))
      }
    }
    return lines.length > 0 ? lines : [[]]
  }
  if (normalizeNodeType(source.type) === "codeBlock") {
    const text = extractPlainTextFromInline(source.content)
    return textToInlineLines(text)
  }
  if (
    normalizeNodeType(source.type) === "paragraph" ||
    normalizeNodeType(source.type) === "heading"
  ) {
    return splitInlineContentByLine(source.content)
  }
  return textToInlineLines(extractPlainTextFromInline(source.content))
}

function extractLinesForListTarget(source: JSONContent): JSONContent[][] {
  const sourceType = resolveCurrentBlockConvertType(source)
  if (
    sourceType === "bullet-list" ||
    sourceType === "ordered-list" ||
    sourceType === "task-list"
  ) {
    return getListItemsFromListNode(source)
  }
  return extractLinesForSingleTarget(source)
}

function buildHeadingNode(
  type: ConvertibleTextBlockType,
  content: JSONContent[] | undefined,
  sourceId: string | null,
  sourceStyleAttrs: BlockStyleAttrs
): JSONContent {
  const isCollapsible = type.startsWith("collapsible-")
  const level = type.endsWith("-1") ? 1 : type.endsWith("-2") ? 2 : 3
  return {
    type: "heading",
    attrs: withOptionalId(
      isCollapsible ? { level, collapsible: true } : { level },
      sourceId,
      sourceStyleAttrs
    ),
    ...(content && content.length > 0 ? { content } : {}),
  }
}

function buildListNode(
  type: ConvertibleTextBlockType,
  lines: JSONContent[][],
  sourceId: string | null,
  sourceStyleAttrs: BlockStyleAttrs
): JSONContent {
  const itemLines = lines.length > 0 ? lines : [[]]
  if (type === "task-list") {
    return {
      type: "taskList",
      attrs: withOptionalId(undefined, sourceId, sourceStyleAttrs),
      content: itemLines.map((line) => ({
        type: "taskItem",
        attrs: { checked: false },
        content: [
          {
            type: "paragraph",
            ...(line.length > 0 ? { content: cloneNode(line) } : {}),
          },
        ],
      })),
    }
  }

  const listNodeType = type === "ordered-list" ? "orderedList" : "bulletList"
  return {
    type: listNodeType,
    attrs: withOptionalId(undefined, sourceId, sourceStyleAttrs),
    content: itemLines.map((line) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          ...(line.length > 0 ? { content: cloneNode(line) } : {}),
        },
      ],
    })),
  }
}

function buildSingleNode(
  type: ConvertibleTextBlockType,
  lines: JSONContent[][],
  sourceId: string | null,
  sourceStyleAttrs: BlockStyleAttrs
): JSONContent {
  if (type === "code-block") {
    const text = lines.map((line) => lineToPlainText(line)).join("\n")
    return {
      type: "codeBlock",
      attrs: withOptionalId(undefined, sourceId, sourceStyleAttrs),
      ...(text ? { content: [{ type: "text", text }] } : {}),
    }
  }

  const inlineContent = joinInlineLines(lines)
  if (type === "paragraph") {
    return {
      type: "paragraph",
      attrs: withOptionalId(undefined, sourceId, sourceStyleAttrs),
      ...(inlineContent.length > 0 ? { content: inlineContent } : {}),
    }
  }

  if (type === "blockquote") {
    return {
      type: "blockquote",
      attrs: withOptionalId(undefined, sourceId, sourceStyleAttrs),
      content: [
        {
          type: "paragraph",
          ...(inlineContent.length > 0 ? { content: inlineContent } : {}),
        },
      ],
    }
  }

  return buildHeadingNode(type, inlineContent, sourceId, sourceStyleAttrs)
}

export function isConvertibleTextBlockType(
  value: unknown
): value is ConvertibleTextBlockType {
  const normalized = String(value ?? "").trim()
  return CONVERTIBLE_TEXT_BLOCK_TYPES.includes(
    normalized as ConvertibleTextBlockType
  )
}

export function resolveCurrentBlockConvertType(
  node: { type?: unknown; attrs?: Record<string, unknown> } | null | undefined
): ConvertibleTextBlockType | null {
  if (!node) {
    return null
  }
  const type = normalizeNodeType(node.type)
  if (type === "paragraph") {
    return "paragraph"
  }
  if (type === "heading") {
    const level = normalizeLevel(node.attrs?.level)
    const collapsible = Boolean(node.attrs?.collapsible)
    if (level === 1) {
      return collapsible ? "collapsible-heading-1" : "heading-1"
    }
    if (level === 2) {
      return collapsible ? "collapsible-heading-2" : "heading-2"
    }
    return collapsible ? "collapsible-heading-3" : "heading-3"
  }
  if (type === "bulletList") {
    return "bullet-list"
  }
  if (type === "orderedList") {
    return "ordered-list"
  }
  if (type === "taskList") {
    return "task-list"
  }
  if (type === "blockquote") {
    return "blockquote"
  }
  if (type === "codeBlock") {
    return "code-block"
  }
  return null
}

export function getConvertibleTargetTypes(
  current: ConvertibleTextBlockType
): ConvertibleTextBlockType[] {
  return CONVERTIBLE_TEXT_BLOCK_TYPES.filter((item) => item !== current)
}

export function convertTopLevelTextBlock(input: {
  source: JSONContent
  targetType: ConvertibleTextBlockType
}): JSONContent {
  const sourceId = normalizeBlockId(input.source?.attrs?.id)
  const sourceStyleAttrs = pickBlockStyleAttrs(
    (input.source?.attrs as Record<string, unknown> | undefined) ?? undefined
  )
  const targetType = input.targetType

  if (
    targetType === "bullet-list" ||
    targetType === "ordered-list" ||
    targetType === "task-list"
  ) {
    const lines = extractLinesForListTarget(input.source)
    return buildListNode(targetType, lines, sourceId, sourceStyleAttrs)
  }

  const lines = extractLinesForSingleTarget(input.source)
  return buildSingleNode(targetType, lines, sourceId, sourceStyleAttrs)
}
