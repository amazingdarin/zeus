import type { JSONContent } from "@tiptap/react"

type ColumnsCount = 2 | 3 | 4 | 5

function paragraphNode(): JSONContent {
  return { type: "paragraph" }
}

function columnNode(content?: JSONContent[]): JSONContent {
  const blocks = Array.isArray(content) && content.length > 0 ? content : [paragraphNode()]
  return {
    type: "column",
    content: blocks,
  }
}

function cloneContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function normalizeColumnsCount(value: unknown): ColumnsCount {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (parsed <= 2 || Number.isNaN(parsed)) {
    return 2
  }
  if (parsed >= 5) {
    return 5
  }
  return parsed as ColumnsCount
}

export function buildColumnsNodeJson(countInput: unknown): JSONContent {
  const count = normalizeColumnsCount(countInput)
  return {
    type: "columns",
    attrs: { count },
    content: Array.from({ length: count }, () => columnNode()),
  }
}

export function resizeColumnsJson(node: JSONContent, nextCountInput: unknown): JSONContent {
  const nextCount = normalizeColumnsCount(nextCountInput)
  const attrs = {
    ...(node.attrs ?? {}),
    count: nextCount,
  }
  const sourceColumns = Array.isArray(node.content)
    ? node.content.filter((item) => item?.type === "column")
    : []
  const normalizedColumns = sourceColumns.map((item) => columnNode(cloneContent(item.content)))

  if (normalizedColumns.length === 0) {
    return {
      type: "columns",
      attrs,
      content: Array.from({ length: nextCount }, () => columnNode()),
    }
  }

  if (normalizedColumns.length < nextCount) {
    const additional = Array.from(
      { length: nextCount - normalizedColumns.length },
      () => columnNode(),
    )
    return {
      ...node,
      attrs,
      content: [...normalizedColumns, ...additional],
    }
  }

  if (normalizedColumns.length === nextCount) {
    return {
      ...node,
      attrs,
      content: normalizedColumns,
    }
  }

  const kept = normalizedColumns.slice(0, nextCount)
  const removed = normalizedColumns.slice(nextCount)
  const removedBlocks = removed.flatMap((item) =>
    Array.isArray(item.content) ? item.content : []
  )
  if (removedBlocks.length > 0) {
    const lastIndex = kept.length - 1
    const lastColumn = kept[lastIndex]
    kept[lastIndex] = columnNode([
      ...(Array.isArray(lastColumn.content) ? cloneContent(lastColumn.content) : [paragraphNode()]),
      ...cloneContent(removedBlocks),
    ])
  }

  return {
    ...node,
    attrs,
    content: kept,
  }
}

