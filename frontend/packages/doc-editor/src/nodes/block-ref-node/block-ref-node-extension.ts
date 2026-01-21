import type { Extension, Range } from "@tiptap/core"
import { mergeAttributes, Node } from "@tiptap/react"
import type { Editor } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"

import { BlockRefNodeView } from "./block-ref-node"

export type BlockRefAttrs = {
  doc_id?: string
  block_id?: string
}

export type BlockRefOptions = {
  projectKey?: string
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  viewerExtensions?: Extension[]
  onTrigger?: (payload: { editor: Editor; range: Range }) => void
  onSelect?: (payload: {
    editor: Editor
    range: Range
    attrs: BlockRefAttrs
  }) => void
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    block_ref: {
      insertBlockRef: (attrs: BlockRefAttrs) => ReturnType
      insertBlockRefAt: (range: Range, attrs: BlockRefAttrs) => ReturnType
    }
  }
}

const triggerKey = new PluginKey("block-ref-trigger")

export const BlockRefNode = Node.create<BlockRefOptions>({
  name: "block_ref",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      projectKey: "",
      fetcher: undefined,
      viewerExtensions: [],
      onTrigger: undefined,
      onSelect: undefined,
    }
  },

  addAttributes() {
    return {
      doc_id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-doc-id") ?? "",
        renderHTML: (attrs) => ({
          "data-doc-id": attrs.doc_id ?? "",
        }),
      },
      block_id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-block-id") ?? "",
        renderHTML: (attrs) => ({
          "data-block-id": attrs.block_id ?? "",
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-ref"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "block-ref" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockRefNodeView)
  },

  addCommands() {
    return {
      insertBlockRef:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
      insertBlockRefAt:
        (range, attrs) =>
        ({ commands }) => {
          return commands.insertContentAt(range, {
            type: this.name,
            attrs,
          })
        },
    }
  },

  addProseMirrorPlugins() {
    if (!this.options.onTrigger || !this.options.projectKey) {
      return []
    }
    return [
      new Plugin({
        key: triggerKey,
        props: {
          handleTextInput: (view, from, to, text) => {
            if (text !== "#" || !this.editor?.isEditable) {
              return false
            }
            const { selection } = view.state
            if (!selection.empty) {
              return false
            }
            const $from = selection.$from
            if ($from.parent.type.name !== "paragraph") {
              return false
            }
            if ($from.parentOffset !== 0) {
              return false
            }
            if ($from.parent.content.size !== 0) {
              return false
            }
            this.options.onTrigger?.({
              editor: this.editor,
              range: { from, to },
            })
            return true
          },
        },
      }),
    ]
  },
})

export default BlockRefNode
