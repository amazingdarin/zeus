import type { NodeWithPos } from "@tiptap/core"

export type BlockStyleAttrName = "backgroundColor" | "textColor"

export type BlockStyleMenuState =
  | { kind: "empty" }
  | { kind: "single"; value: string }
  | { kind: "mixed" }

function normalizeStyleValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildBlockStyleMenuState(
  values: Array<string | null | undefined>
): BlockStyleMenuState {
  const normalized = Array.from(
    new Set(values.map((value) => normalizeStyleValue(value)).filter(Boolean))
  ) as string[]

  if (normalized.length === 0) {
    return { kind: "empty" }
  }
  if (normalized.length === 1) {
    return { kind: "single", value: normalized[0] }
  }
  return { kind: "mixed" }
}

export function collectNodeStyleValues(
  nodes: NodeWithPos[],
  attrName: BlockStyleAttrName
): Array<string | null> {
  return nodes.map((target) =>
    normalizeStyleValue((target.node.attrs as Record<string, unknown>)?.[attrName])
  )
}
