import type { JSONContent } from "@tiptap/react"

type ColumnsCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const MIN_COLUMNS = 2
const MAX_COLUMNS = 8
const DEFAULT_COLUMN_WIDTH = 1

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
  if (parsed <= MIN_COLUMNS || Number.isNaN(parsed)) {
    return MIN_COLUMNS
  }
  if (parsed >= MAX_COLUMNS) {
    return MAX_COLUMNS
  }
  return parsed as ColumnsCount
}

function normalizeSingleColumnWidth(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_COLUMN_WIDTH
  }
  return Number(parsed.toFixed(4))
}

export function createDefaultColumnWidths(countInput: unknown): number[] {
  const count = normalizeColumnsCount(countInput)
  return Array.from({ length: count }, () => DEFAULT_COLUMN_WIDTH)
}

export function normalizeColumnsWidths(value: unknown, countInput: unknown): number[] {
  const count = normalizeColumnsCount(countInput)
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : []
  const normalized = source
    .map((item) => normalizeSingleColumnWidth(item))
    .slice(0, count)
  while (normalized.length < count) {
    normalized.push(DEFAULT_COLUMN_WIDTH)
  }
  return normalized
}

export function buildColumnsNodeJson(countInput: unknown): JSONContent {
  const count = normalizeColumnsCount(countInput)
  const widths = createDefaultColumnWidths(count)
  return {
    type: "columns",
    attrs: { count, widths },
    content: Array.from({ length: count }, () => columnNode()),
  }
}

export function resizeColumnsJson(
  node: JSONContent,
  nextCountInput: unknown,
  nextWidthsInput?: unknown
): JSONContent {
  const nextCount = normalizeColumnsCount(nextCountInput)
  const currentCount = normalizeColumnsCount(node?.attrs?.count ?? nextCount)
  const currentWidths = normalizeColumnsWidths(node?.attrs?.widths, currentCount)
  const nextWidths = nextWidthsInput === undefined
    ? normalizeColumnsWidths(currentWidths, nextCount)
    : normalizeColumnsWidths(nextWidthsInput, nextCount)
  const attrs = {
    ...(node.attrs ?? {}),
    count: nextCount,
    widths: nextWidths,
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
