export type BuiltinBlockType =
  | "paragraph"
  | "heading-1"
  | "collapsible-heading-1"
  | "heading-2"
  | "collapsible-heading-2"
  | "heading-3"
  | "collapsible-heading-3"
  | "toggle-block"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "horizontal-rule"
  | "code-block"
  | "math"
  | "chart"
  | "mindmap"
  | "toc"
  | "link-preview"
  | "image"
  | "file"
  | "table"
  | "columns";

export type DocumentBlockShortcuts = Record<string, BuiltinBlockType>;

export const DEFAULT_DOCUMENT_BLOCK_SHORTCUTS: DocumentBlockShortcuts = {
  "1": "heading-1",
  "1>": "collapsible-heading-1",
  "2": "heading-2",
  "2>": "collapsible-heading-2",
  "3": "heading-3",
  "3>": "collapsible-heading-3",
  "0": "paragraph",
  "4": "toggle-block",
  col: "columns",
};

const BUILTIN_BLOCK_TYPE_SET = new Set<string>([
  "paragraph",
  "heading-1",
  "collapsible-heading-1",
  "heading-2",
  "collapsible-heading-2",
  "heading-3",
  "collapsible-heading-3",
  "toggle-block",
  "bullet-list",
  "ordered-list",
  "task-list",
  "blockquote",
  "horizontal-rule",
  "code-block",
  "math",
  "chart",
  "mindmap",
  "toc",
  "link-preview",
  "image",
  "file",
  "table",
  "columns",
]);

function isBuiltinBlockType(value: string): value is BuiltinBlockType {
  return BUILTIN_BLOCK_TYPE_SET.has(value);
}

function normalizeLegacyBlockType(value: string): string {
  if (
    value === "columns-2"
    || value === "columns-3"
    || value === "columns-4"
    || value === "columns-5"
  ) {
    return "columns";
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeShortcutKey(input: string): string | null {
  const normalized = input.trim();
  if (!normalized || normalized.length > 16) {
    return null;
  }
  if (normalized.includes("/") || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function sanitizeDocumentBlockShortcuts(input: unknown): DocumentBlockShortcuts {
  if (input == null) {
    return { ...DEFAULT_DOCUMENT_BLOCK_SHORTCUTS };
  }
  if (!isPlainObject(input)) {
    return { ...DEFAULT_DOCUMENT_BLOCK_SHORTCUTS };
  }

  const normalized: DocumentBlockShortcuts = {};
  const usedBlocks = new Set<BuiltinBlockType>();
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeShortcutKey(rawKey);
    const blockType = normalizeLegacyBlockType(String(rawValue ?? "").trim());
    if (!key || !isBuiltinBlockType(blockType)) {
      continue;
    }
    if (usedBlocks.has(blockType)) {
      continue;
    }
    usedBlocks.add(blockType);
    normalized[key] = blockType;
  }
  return normalized;
}

export function validateDocumentBlockShortcutsInput(input: unknown):
  | { ok: true; value: DocumentBlockShortcuts }
  | { ok: false; message: string } {
  if (!isPlainObject(input)) {
    return { ok: false, message: "document_block_shortcuts must be an object" };
  }

  const normalized: DocumentBlockShortcuts = {};
  const usedBlocks = new Set<BuiltinBlockType>();
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeShortcutKey(rawKey);
    if (!key) {
      return { ok: false, message: `invalid shortcut key: ${rawKey}` };
    }
    const blockType = normalizeLegacyBlockType(String(rawValue ?? "").trim());
    if (!isBuiltinBlockType(blockType)) {
      return { ok: false, message: `invalid block type: ${blockType || "<empty>"}` };
    }
    if (usedBlocks.has(blockType)) {
      return { ok: false, message: `duplicate block shortcut mapping for ${blockType}` };
    }
    usedBlocks.add(blockType);
    normalized[key] = blockType;
  }

  return { ok: true, value: normalized };
}
