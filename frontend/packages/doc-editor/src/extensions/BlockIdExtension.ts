import { Extension } from "@tiptap/core"
import { Extension, type JSONContent } from "@tiptap/react"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import { Plugin, PluginKey } from "@tiptap/pm/state"

const BLOCK_ID_NODE_TYPES = [
  "paragraph",
  "heading",
  "codeBlock",
  "plantuml",
  "listItem",
  "taskItem",
  "blockquote",
] as const

const BLOCK_ID_NODE_SET = new Set<string>(BLOCK_ID_NODE_TYPES)

const createBlockId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `bid_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

const normalizeId = (value: unknown) => {
  if (typeof value !== "string") {
    return ""
  }
  return value.trim()
}

const applyBlockIdsToDoc = (state: EditorState) => {
  const usedIds = new Set<string>()
  const tr = state.tr
  let changed = false

  state.doc.descendants((node, pos) => {
    if (!BLOCK_ID_NODE_SET.has(node.type.name)) {
      return
    }
    const currentId = normalizeId(node.attrs?.id)
    if (!currentId || usedIds.has(currentId)) {
      const nextId = createBlockId()
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: nextId }, node.marks)
      usedIds.add(nextId)
      changed = true
      return
    }
    usedIds.add(currentId)
  })

  if (!changed) {
    return null
  }
  tr.setMeta("addToHistory", false)
  return tr
}

export const ensureBlockIds = (content: JSONContent): JSONContent => {
  const usedIds = new Set<string>()

  const visit = (node: JSONContent): JSONContent => {
    if (!node) {
      return node
    }

    let nextNode = node
    let mutated = false

    if (Array.isArray(node.content)) {
      const nextContent = node.content.map(visit)
      const contentChanged = nextContent.some(
        (child, index) => child !== node.content?.[index]
      )
      if (contentChanged) {
        nextNode = { ...nextNode }
        nextNode.content = nextContent
        mutated = true
      }
    }

    const type = node.type ?? ""
    if (BLOCK_ID_NODE_SET.has(type)) {
      const currentId = normalizeId(node.attrs?.id)
      if (!currentId || usedIds.has(currentId)) {
        const nextId = createBlockId()
        const nextAttrs = { ...(node.attrs ?? {}), id: nextId }
        if (!mutated) {
          nextNode = { ...nextNode }
          mutated = true
        }
        nextNode.attrs = nextAttrs
        usedIds.add(nextId)
      } else {
        usedIds.add(currentId)
      }
    }

    return nextNode
  }

  return visit(content)
}

export const BlockIdExtension = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_ID_NODE_TYPES],
        attributes: {
          id: {
            default: null as string | null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-block-id") || null,
            renderHTML: (attributes) => {
              const id = normalizeId(attributes.id)
              if (!id) {
                return {}
              }
              return {
                "data-block-id": id,
              }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockId"),
        appendTransaction: (
          transactions: Transaction[],
          _oldState: EditorState,
          newState: EditorState
        ) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null
          }
          return applyBlockIdsToDoc(newState)
        },
      }),
    ]
  },
})
