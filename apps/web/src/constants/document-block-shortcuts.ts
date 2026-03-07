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
  | "columns"
  // Legacy aliases kept for backward compatibility with stored settings.
  | "columns-2"
  | "columns-3"
  | "columns-4"
  | "columns-5";

export type DocumentBlockShortcutPayload = Partial<Record<string, BuiltinBlockType>>;
export type DocumentBlockShortcutFormValue = Partial<Record<BuiltinBlockType, string>>;

export const DOCUMENT_BLOCK_SHORTCUT_FIELDS: Array<{ id: BuiltinBlockType; label: string }> = [
  { id: "paragraph", label: "段落" },
  { id: "heading-1", label: "标题 1" },
  { id: "collapsible-heading-1", label: "可折叠标题 1" },
  { id: "heading-2", label: "标题 2" },
  { id: "collapsible-heading-2", label: "可折叠标题 2" },
  { id: "heading-3", label: "标题 3" },
  { id: "collapsible-heading-3", label: "可折叠标题 3" },
  { id: "toggle-block", label: "折叠块" },
  { id: "bullet-list", label: "无序列表" },
  { id: "ordered-list", label: "有序列表" },
  { id: "task-list", label: "任务列表" },
  { id: "blockquote", label: "引用" },
  { id: "horizontal-rule", label: "分割线" },
  { id: "code-block", label: "代码块" },
  { id: "math", label: "数学公式" },
  { id: "chart", label: "图表" },
  { id: "mindmap", label: "脑图" },
  { id: "toc", label: "目录" },
  { id: "link-preview", label: "链接预览" },
  { id: "image", label: "图片" },
  { id: "file", label: "文件" },
  { id: "table", label: "表格" },
  { id: "columns", label: "多列块" },
];

const BUILTIN_BLOCK_TYPE_SET = new Set(
  DOCUMENT_BLOCK_SHORTCUT_FIELDS.map((item) => item.id)
);

export const DEFAULT_DOCUMENT_BLOCK_SHORTCUTS: DocumentBlockShortcutPayload = {
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

function isBuiltinBlockType(value: string): value is BuiltinBlockType {
  return BUILTIN_BLOCK_TYPE_SET.has(value as BuiltinBlockType);
}

function normalizeLegacyBlockType(value: string): BuiltinBlockType | null {
  if (
    value === "columns-2"
    || value === "columns-3"
    || value === "columns-4"
    || value === "columns-5"
  ) {
    return "columns";
  }
  if (isBuiltinBlockType(value)) {
    return value;
  }
  return null;
}

export function normalizeShortcutValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 16 || trimmed.includes("/") || /\s/.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export function sanitizeDocumentBlockShortcuts(
  input: unknown
): DocumentBlockShortcutPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_DOCUMENT_BLOCK_SHORTCUTS };
  }
  const sanitized: DocumentBlockShortcutPayload = {};
  const usedBlocks = new Set<BuiltinBlockType>();

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const shortcut = normalizeShortcutValue(rawKey);
    const blockType = normalizeLegacyBlockType(String(rawValue ?? "").trim());
    if (!shortcut || !blockType || usedBlocks.has(blockType)) {
      continue;
    }
    sanitized[shortcut] = blockType;
    usedBlocks.add(blockType);
  }
  return sanitized;
}

export function toBlockShortcutFormValue(
  shortcuts: DocumentBlockShortcutPayload
): DocumentBlockShortcutFormValue {
  const formValue: DocumentBlockShortcutFormValue = {};
  for (const [shortcut, blockType] of Object.entries(shortcuts)) {
    const normalizedBlockType = normalizeLegacyBlockType(String(blockType ?? "").trim());
    if (!normalizedBlockType) {
      continue;
    }
    formValue[normalizedBlockType] = shortcut;
  }
  return formValue;
}

export function toShortcutPayload(
  formValue: DocumentBlockShortcutFormValue
): DocumentBlockShortcutPayload {
  const payload: DocumentBlockShortcutPayload = {};
  const usedBlocks = new Set<BuiltinBlockType>();
  for (const [blockType, rawShortcut] of Object.entries(formValue)) {
    const shortcut = normalizeShortcutValue(String(rawShortcut ?? ""));
    const normalizedBlockType = normalizeLegacyBlockType(blockType);
    if (!shortcut || !normalizedBlockType || usedBlocks.has(normalizedBlockType)) {
      continue;
    }
    payload[shortcut] = normalizedBlockType;
    usedBlocks.add(normalizedBlockType);
  }
  return payload;
}

export function buildShortcutConflictMap(
  formValue: DocumentBlockShortcutFormValue
): Partial<Record<BuiltinBlockType, boolean>> {
  const normalizedByBlock: Array<[BuiltinBlockType, string]> = [];
  for (const [blockType, rawShortcut] of Object.entries(formValue)) {
    const normalizedBlockType = normalizeLegacyBlockType(blockType);
    if (!normalizedBlockType) {
      continue;
    }
    const shortcut = normalizeShortcutValue(String(rawShortcut ?? ""));
    if (!shortcut) {
      continue;
    }
    normalizedByBlock.push([normalizedBlockType, shortcut]);
  }

  const counts = new Map<string, number>();
  for (const [, shortcut] of normalizedByBlock) {
    counts.set(shortcut, (counts.get(shortcut) ?? 0) + 1);
  }

  const conflictMap: Partial<Record<BuiltinBlockType, boolean>> = {};
  for (const [blockType, shortcut] of normalizedByBlock) {
    conflictMap[blockType] = (counts.get(shortcut) ?? 0) > 1;
  }
  return conflictMap;
}
