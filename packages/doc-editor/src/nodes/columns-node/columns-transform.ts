import type { JSONContent } from "@tiptap/react"

type ColumnsCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const MIN_COLUMNS = 2
const MAX_COLUMNS = 8
const DEFAULT_COLUMN_WIDTH = 1
const DEFAULT_COLUMN_GAP_PX = 12
const DEFAULT_MIN_COLUMN_WIDTH_PX = 140
const MIN_COLUMN_WIDTH_RATIO = 0.08

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

export function resolveColumnResizeHandlePercents(
  widthsInput: unknown,
  countInput: unknown
): number[] {
  const count = normalizeColumnsCount(countInput)
  const widths = normalizeColumnsWidths(widthsInput, count)
  const total = widths.reduce((sum, item) => sum + item, 0)
  if (!(total > 0)) {
    return []
  }
  const result: number[] = []
  let accumulated = 0
  for (let index = 0; index < widths.length - 1; index += 1) {
    accumulated += widths[index]
    result.push(Number(((accumulated / total) * 100).toFixed(4)))
  }
  return result
}

export function resolveColumnResizeHandleLayouts(
  widthsInput: unknown,
  countInput: unknown,
  gapPxInput: unknown = DEFAULT_COLUMN_GAP_PX
): Array<{ percent: number; offsetPx: number }> {
  const count = normalizeColumnsCount(countInput)
  const percents = resolveColumnResizeHandlePercents(widthsInput, count)
  const gapPxRaw = Number(gapPxInput)
  const gapPx =
    Number.isFinite(gapPxRaw) && gapPxRaw >= 0
      ? gapPxRaw
      : DEFAULT_COLUMN_GAP_PX
  const totalGaps = Math.max(0, count - 1)
  return percents.map((percent, index) => {
    const ratio = percent / 100
    const offsetPx = Number(((index + 0.5 - ratio * totalGaps) * gapPx).toFixed(4))
    return { percent, offsetPx }
  })
}

export function resizeAdjacentColumnsWidths(options: {
  widths: unknown
  count: unknown
  handleIndex: unknown
  containerWidthPx: unknown
  deltaPx: unknown
  minColumnWidthPx?: unknown
  gapPx?: unknown
}): number[] {
  const count = normalizeColumnsCount(options.count)
  const widths = normalizeColumnsWidths(options.widths, count)
  if (count < 2) {
    return widths
  }

  const handleIndex = Number.parseInt(String(options.handleIndex ?? ""), 10)
  if (!Number.isFinite(handleIndex) || handleIndex < 0 || handleIndex >= count - 1) {
    return widths
  }

  const containerWidthPx = Number(options.containerWidthPx)
  if (!Number.isFinite(containerWidthPx) || containerWidthPx <= 0) {
    return widths
  }

  const deltaPx = Number(options.deltaPx)
  if (!Number.isFinite(deltaPx) || deltaPx === 0) {
    return widths
  }

  const gapPxRaw = Number(options.gapPx ?? DEFAULT_COLUMN_GAP_PX)
  const gapPx =
    Number.isFinite(gapPxRaw) && gapPxRaw >= 0
      ? gapPxRaw
      : DEFAULT_COLUMN_GAP_PX
  const availableWidthPx = Math.max(1, containerWidthPx - (count - 1) * gapPx)

  const totalWeight = widths.reduce((sum, value) => sum + value, 0)
  if (!(totalWeight > 0)) {
    return createDefaultColumnWidths(count)
  }

  const pairTotal = widths[handleIndex] + widths[handleIndex + 1]
  if (!(pairTotal > 0)) {
    return widths
  }

  const minColumnWidthPxRaw = Number(options.minColumnWidthPx ?? DEFAULT_MIN_COLUMN_WIDTH_PX)
  const minColumnWidthPx =
    Number.isFinite(minColumnWidthPxRaw) && minColumnWidthPxRaw > 0
      ? minColumnWidthPxRaw
      : DEFAULT_MIN_COLUMN_WIDTH_PX
  const minByPx = (minColumnWidthPx / availableWidthPx) * totalWeight
  const minByRatio = totalWeight * MIN_COLUMN_WIDTH_RATIO
  let minWeight = Number(Math.max(minByPx, minByRatio).toFixed(4))
  const maxAllowedMinWeight = Number((pairTotal / 2).toFixed(4))
  if (minWeight > maxAllowedMinWeight) {
    minWeight = maxAllowedMinWeight
  }

  const deltaWeight = (deltaPx / availableWidthPx) * totalWeight
  const nextLeftRaw = Math.max(
    minWeight,
    Math.min(pairTotal - minWeight, widths[handleIndex] + deltaWeight)
  )
  const nextLeft = Number(nextLeftRaw.toFixed(4))
  const nextRight = Number((pairTotal - nextLeft).toFixed(4))

  const next = [...widths]
  next[handleIndex] = nextLeft
  next[handleIndex + 1] = nextRight
  return next
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
