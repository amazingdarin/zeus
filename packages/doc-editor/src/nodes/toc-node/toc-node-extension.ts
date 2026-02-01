import { mergeAttributes, Node } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { TocNodeView } from "./toc-node"

export type TocNodeAttrs = {
  minLevel?: number
  maxLevel?: number
  title?: string
}

export type TocNodeOptions = Record<string, never>

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toc: {
      insertToc: (attrs?: TocNodeAttrs) => ReturnType
    }
  }
}

export const TocNode = Node.create<TocNodeOptions>({
  name: "toc",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addAttributes() {
    return {
      minLevel: {
        default: 1,
        parseHTML: (element) => {
          const val = element.getAttribute("data-min-level")
          return val ? parseInt(val, 10) : 1
        },
        renderHTML: (attrs) => ({ "data-min-level": attrs.minLevel ?? 1 }),
      },
      maxLevel: {
        default: 4,
        parseHTML: (element) => {
          const val = element.getAttribute("data-max-level")
          return val ? parseInt(val, 10) : 4
        },
        renderHTML: (attrs) => ({ "data-max-level": attrs.maxLevel ?? 4 }),
      },
      title: {
        default: "目录",
        parseHTML: (element) => element.getAttribute("data-title") ?? "目录",
        renderHTML: (attrs) => ({ "data-title": attrs.title ?? "目录" }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "toc" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocNodeView)
  },

  addCommands() {
    return {
      insertToc:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: attrs ?? {},
          }),
    }
  },
})

export default TocNode
