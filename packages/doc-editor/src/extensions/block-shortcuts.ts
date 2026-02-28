import { BUILTIN_BLOCK_TYPES, type BuiltinBlockType } from "./block-add-handle"

export type DocumentBlockShortcutsInput =
  | Record<string, string | undefined>
  | null
  | undefined

export type DocumentBlockShortcuts = {
  keyToBlockMap: Record<string, BuiltinBlockType>
  blockToKeyMap: Partial<Record<BuiltinBlockType, string>>
}

export const DEFAULT_DOCUMENT_BLOCK_SHORTCUTS: Record<string, BuiltinBlockType> = {
  "1": "heading-1",
  "2": "heading-2",
  "3": "heading-3",
  "0": "paragraph",
  "4": "toggle-block",
}

const BUILTIN_BLOCK_TYPE_SET = new Set<string>(BUILTIN_BLOCK_TYPES)

function isBuiltinBlockType(value: string): value is BuiltinBlockType {
  return BUILTIN_BLOCK_TYPE_SET.has(value)
}

function normalizeShortcutKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  if (!normalized || normalized.length !== 1) {
    return null
  }
  if (normalized === "/") {
    return null
  }
  return normalized
}

export function resolveDocumentBlockShortcuts(
  input: DocumentBlockShortcutsInput
): DocumentBlockShortcuts {
  const source =
    input && typeof input === "object" ? input : DEFAULT_DOCUMENT_BLOCK_SHORTCUTS
  const keyToBlockMap: Record<string, BuiltinBlockType> = {}
  const blockToKeyMap: Partial<Record<BuiltinBlockType, string>> = {}

  for (const [rawKey, rawBlockType] of Object.entries(source)) {
    const key = normalizeShortcutKey(rawKey)
    const blockType = String(rawBlockType ?? "").trim()
    if (!key || !isBuiltinBlockType(blockType)) {
      continue
    }
    if (blockToKeyMap[blockType]) {
      continue
    }
    keyToBlockMap[key] = blockType
    blockToKeyMap[blockType] = key
  }

  if (Object.keys(keyToBlockMap).length > 0) {
    return { keyToBlockMap, blockToKeyMap }
  }

  const fallbackKeyToBlockMap = { ...DEFAULT_DOCUMENT_BLOCK_SHORTCUTS }
  const fallbackBlockToKeyMap: Partial<Record<BuiltinBlockType, string>> = {}
  for (const [key, blockType] of Object.entries(fallbackKeyToBlockMap)) {
    fallbackBlockToKeyMap[blockType] = key
  }
  return {
    keyToBlockMap: fallbackKeyToBlockMap,
    blockToKeyMap: fallbackBlockToKeyMap,
  }
}

export function matchSlashShortcutToken(input: {
  token: string
  keyToBlockMap: Record<string, BuiltinBlockType>
}): BuiltinBlockType | null {
  if (!input.token.startsWith("/") || input.token.length !== 2) {
    return null
  }
  const key = input.token.slice(1)
  if (!key || key.length !== 1) {
    return null
  }
  return input.keyToBlockMap[key] ?? null
}
