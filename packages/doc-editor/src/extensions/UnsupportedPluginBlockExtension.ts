import { mergeAttributes, Node, type JSONContent } from "@tiptap/core"

type UnsupportedPluginBlockAttrs = {
  id?: string | null
  originalType?: string
  originalJson?: string
  message?: string
}

const DEFAULT_KNOWN_NODE_TYPES = new Set<string>([
  "doc",
  "text",
  "hardBreak",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
  "imageUpload",
  "linkPreview",
  "fileBlock",
  "file_block",
  "blockRef",
  "openapi",
  "openapiRef",
  "toc",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "math",
  "chart",
  "mindmap",
  "columns",
  "column",
  "unsupportedPluginBlock",
])

const BLOCK_CONTAINER_NODE_TYPES = new Set<string>([
  "doc",
  "blockquote",
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
  "column",
])

const INLINE_SAFE_PARENT_TYPES = new Set<string>([
  "paragraph",
  "heading",
])

function normalizeType(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized || null
}

function stringifyNode(node: JSONContent): string {
  try {
    return JSON.stringify(node)
  } catch {
    return "{}"
  }
}

function toUnsupportedNode(node: JSONContent): JSONContent {
  const originalType = normalizeType(node.type) || "unknown"
  const attrs = (node.attrs || {}) as Record<string, unknown>
  const preservedId = normalizeId(attrs.id)
  return {
    type: "unsupportedPluginBlock",
    attrs: {
      ...(preservedId ? { id: preservedId } : {}),
      originalType,
      originalJson: stringifyNode(node),
      message: `Unsupported plugin block: ${originalType}`,
    },
  }
}

function toInlineFallbackText(nodeType: string): JSONContent {
  return {
    type: "text",
    text: `[Unsupported plugin node: ${nodeType || "unknown"}]`,
  }
}

function normalizeNodeTree(
  node: JSONContent,
  knownNodeTypes: Set<string>,
  parentType?: string,
): JSONContent {
  const nodeType = normalizeType(node.type)
  const isKnown = nodeType ? knownNodeTypes.has(nodeType) : false

  let nextNode = node
  if (Array.isArray(node.content)) {
    const nextContent = node.content.map((child) => normalizeNodeTree(child, knownNodeTypes, nodeType))
    const changed = nextContent.some((child, idx) => child !== node.content?.[idx])
    if (changed) {
      nextNode = { ...nextNode, content: nextContent }
    }
  }

  if (isKnown) {
    return nextNode
  }

  if (nodeType === "text" || nodeType === "hardBreak") {
    return nextNode
  }

  if (!parentType || BLOCK_CONTAINER_NODE_TYPES.has(parentType)) {
    return toUnsupportedNode(nextNode)
  }

  if (INLINE_SAFE_PARENT_TYPES.has(parentType)) {
    return toInlineFallbackText(nodeType)
  }

  return toUnsupportedNode(nextNode)
}

export function collectKnownEditorNodeTypes(extraNodeTypes: string[] = []): string[] {
  const names = new Set<string>(DEFAULT_KNOWN_NODE_TYPES)
  for (const item of extraNodeTypes) {
    const normalized = normalizeType(item)
    if (normalized) {
      names.add(normalized)
    }
  }
  return Array.from(names)
}

export function normalizeUnsupportedPluginBlocks(
  content: JSONContent,
  options?: { knownNodeTypes?: string[] },
): JSONContent {
  if (!content || typeof content !== "object") {
    return content
  }

  const knownNodeTypes = new Set<string>(
    collectKnownEditorNodeTypes(options?.knownNodeTypes || []),
  )
  const rootType = normalizeType(content.type)
  if (rootType && rootType !== "doc") {
    return {
      type: "doc",
      content: [toUnsupportedNode(content)],
    }
  }

  return normalizeNodeTree(content, knownNodeTypes)
}

export const UnsupportedPluginBlock = Node.create({
  name: "unsupportedPluginBlock",

  group: "block",

  atom: true,

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
        renderHTML: (attrs: UnsupportedPluginBlockAttrs) => {
          const id = normalizeId(attrs.id)
          return id ? { "data-block-id": id } : {}
        },
      },
      originalType: {
        default: "unknown",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-original-type") || "unknown",
        renderHTML: (attrs: UnsupportedPluginBlockAttrs) => {
          const originalType = normalizeType(attrs.originalType) || "unknown"
          return { "data-original-type": originalType }
        },
      },
      originalJson: {
        default: "{}",
        parseHTML: () => "{}",
        renderHTML: () => ({}),
      },
      message: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-message"),
        renderHTML: (attrs: UnsupportedPluginBlockAttrs) => {
          const message = typeof attrs.message === "string" ? attrs.message : ""
          return message ? { "data-message": message } : {}
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="unsupported-plugin-block"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const originalType = normalizeType(node.attrs.originalType) || "unknown"
    const rawMessage = normalizeType(node.attrs.message)
    const message = rawMessage || `Unsupported plugin block: ${originalType}`
    return [
      "div",
      mergeAttributes(
        {
          "data-type": "unsupported-plugin-block",
          class: "unsupported-plugin-block",
        },
        HTMLAttributes,
      ),
      message,
    ]
  },
})
