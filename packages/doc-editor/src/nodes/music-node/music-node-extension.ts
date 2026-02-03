import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { InputRule } from "@tiptap/core"
import { MusicNodeView } from "./music-node"

export interface MusicNodeOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    music: {
      /**
       * Insert a music score
       */
      insertMusic: (options: { abc: string; display?: boolean }) => ReturnType
    }
  }
}

/**
 * Music Node Extension for Tiptap
 * Supports both inline (~abc:...~) and block (```abc...```) ABC notation
 * Rendered using abcjs
 */
export const MusicNode = Node.create<MusicNodeOptions>({
  name: "music",

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
      abc: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-abc") || "",
        renderHTML: (attributes) => ({
          "data-abc": attributes.abc,
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
        tag: 'span[data-type="music"]',
      },
      {
        tag: 'div[data-type="music-block"]',
        getAttrs: () => ({ display: true }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const tag = node.attrs.display ? "div" : "span"
    const dataType = node.attrs.display ? "music-block" : "music"
    return [
      tag,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": dataType,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MusicNodeView)
  },

  addCommands() {
    return {
      insertMusic:
        ({ abc, display = false }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { abc, display },
          })
        },
    }
  },

  addInputRules() {
    // Inline music: ~abc:...~
    const inlineMusicRule = new InputRule({
      find: /~abc:([^~]+)~$/,
      handler: ({ state, range, match }) => {
        const abc = match[1]
        const { tr } = state
        const node = this.type.create({ abc, display: false })
        tr.replaceWith(range.from, range.to, node)
      },
    })

    return [inlineMusicRule]
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-u": () => {
        return this.editor.commands.insertMusic({ abc: "", display: false })
      },
      "Mod-Shift-U": () => {
        return this.editor.commands.insertMusic({ abc: "", display: true })
      },
    }
  },
})

export default MusicNode
