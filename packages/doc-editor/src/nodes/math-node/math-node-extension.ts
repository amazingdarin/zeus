import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { InputRule } from "@tiptap/core"
import { MathNodeView } from "./math-node"

export interface MathNodeOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      /**
       * Insert a math formula
       */
      insertMath: (options: { latex: string; display?: boolean }) => ReturnType
    }
  }
}

/**
 * Math Node Extension for Tiptap
 * Supports both inline ($...$) and block ($$...$$) math formulas
 * Rendered using KaTeX
 */
export const MathNode = Node.create<MathNodeOptions>({
  name: "math",

  // Support both inline and block
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex") || "",
        renderHTML: (attributes) => ({
          "data-latex": attributes.latex,
        }),
      },
      display: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-display") === "true",
        renderHTML: (attributes) => ({
          "data-display": attributes.display ? "true" : "false",
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="math"]',
      },
      {
        tag: 'div[data-type="math-block"]',
        getAttrs: () => ({ display: true }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const tag = node.attrs.display ? "div" : "span"
    const dataType = node.attrs.display ? "math-block" : "math"
    return [
      tag,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": dataType,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },

  addCommands() {
    return {
      insertMath:
        ({ latex, display = false }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex, display },
          })
        },
    }
  },

  addInputRules() {
    // Block math: $$...$$
    const blockMathRule = new InputRule({
      find: /\$\$([^$]+)\$\$$/,
      handler: ({ state, range, match }) => {
        const latex = match[1]
        const { tr } = state
        const node = this.type.create({ latex, display: true })
        tr.replaceWith(range.from, range.to, node)
      },
    })

    // Inline math: $...$
    const inlineMathRule = new InputRule({
      find: /(?<!\$)\$([^$\n]+)\$$/,
      handler: ({ state, range, match }) => {
        const latex = match[1]
        const { tr } = state
        const node = this.type.create({ latex, display: false })
        tr.replaceWith(range.from, range.to, node)
      },
    })

    return [blockMathRule, inlineMathRule]
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => {
        return this.editor.commands.insertMath({ latex: "", display: false })
      },
      "Mod-Shift-M": () => {
        return this.editor.commands.insertMath({ latex: "", display: true })
      },
    }
  },
})

export default MathNode
