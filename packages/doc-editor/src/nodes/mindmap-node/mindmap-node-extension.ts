import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { InputRule } from "@tiptap/core"
import { MindmapNodeView } from "./mindmap-node"
import {
  DEFAULT_MINDMAP_DATA,
  stringifyTreeData,
  type MindmapLayout,
} from "./mindmap-converter"

export type MindmapMode = "outline" | "text"

export interface MindmapNodeOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mindmap: {
      /**
       * Insert a mind map
       */
      insertMindmap: (options?: {
        layout?: MindmapLayout
      }) => ReturnType
    }
  }
}

const DEFAULT_DATA_STR = stringifyTreeData(DEFAULT_MINDMAP_DATA)

/**
 * Mindmap Node Extension for Tiptap
 * Renders an interactive mind map using ECharts tree layout
 */
export const MindmapNode = Node.create<MindmapNodeOptions>({
  name: "mindmap",

  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      // Tree data JSON string
      data: {
        default: DEFAULT_DATA_STR,
        parseHTML: (element) =>
          element.getAttribute("data-mindmap-data") || DEFAULT_DATA_STR,
        renderHTML: (attributes) => ({
          "data-mindmap-data": attributes.data,
        }),
      },
      // Editing mode
      mode: {
        default: "outline" as MindmapMode,
        parseHTML: (element) =>
          (element.getAttribute("data-mindmap-mode") as MindmapMode) ||
          "outline",
        renderHTML: (attributes) => ({
          "data-mindmap-mode": attributes.mode,
        }),
      },
      // Layout direction
      layout: {
        default: "LR" as MindmapLayout,
        parseHTML: (element) =>
          (element.getAttribute("data-mindmap-layout") as MindmapLayout) ||
          "LR",
        renderHTML: (attributes) => ({
          "data-mindmap-layout": attributes.layout,
        }),
      },
      // Display height in pixels
      height: {
        default: 400,
        parseHTML: (element) =>
          parseInt(element.getAttribute("data-mindmap-height") || "400", 10),
        renderHTML: (attributes) => ({
          "data-mindmap-height": String(attributes.height),
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mindmap"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mindmap",
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MindmapNodeView)
  },

  addCommands() {
    return {
      insertMindmap:
        (options = {}) =>
        ({ commands }) => {
          const layout = options.layout || "LR"
          return commands.insertContent({
            type: this.name,
            attrs: {
              data: DEFAULT_DATA_STR,
              mode: "outline",
              layout,
              height: 400,
            },
          })
        },
    }
  },

  addInputRules() {
    const mindmapInputRule = new InputRule({
      find: /^```mindmap\s$/,
      handler: ({ state, range }) => {
        const { tr } = state
        const node = this.type.create({
          data: DEFAULT_DATA_STR,
          mode: "outline",
          layout: "LR",
          height: 400,
        })
        tr.replaceWith(range.from, range.to, node)
      },
    })

    return [mindmapInputRule]
  },
})

export default MindmapNode
