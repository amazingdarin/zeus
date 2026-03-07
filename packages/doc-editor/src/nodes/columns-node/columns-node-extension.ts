import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"

import { ColumnsNodeView } from "./columns-node"
import {
  buildColumnsNodeJson,
  normalizeColumnsCount,
  normalizeColumnsWidths,
  resizeColumnsJson,
} from "./columns-transform"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (options?: { count?: number; widths?: unknown }) => ReturnType
      setColumnsCount: (options: { pos: number; count: number; widths?: unknown }) => ReturnType
    }
  }
}

function isInsideColumnSelection(state: { selection: { $from: { depth: number; node: (depth: number) => { type: { name: string } } } } }): boolean {
  const from = state.selection.$from
  for (let depth = from.depth; depth >= 0; depth -= 1) {
    if (from.node(depth).type.name === "column") {
      return true
    }
  }
  return false
}

export const ColumnNode = Node.create({
  name: "column",

  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "column",
        class: "doc-editor-column",
      }),
      0,
    ]
  },
})

export const ColumnsNode = Node.create({
  name: "columns",

  group: "block",
  content: "column+",
  isolating: true,
  draggable: true,

  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (element) => normalizeColumnsCount(element.getAttribute("data-columns-count")),
        renderHTML: (attributes) => ({
          "data-columns-count": String(normalizeColumnsCount(attributes.count)),
        }),
      },
      widths: {
        default: [1, 1],
        parseHTML: (element) => {
          const count = normalizeColumnsCount(element.getAttribute("data-columns-count"))
          return normalizeColumnsWidths(element.getAttribute("data-column-widths"), count)
        },
        renderHTML: (attributes) => {
          const count = normalizeColumnsCount(attributes.count)
          const widths = normalizeColumnsWidths(attributes.widths, count)
          return {
            "data-column-widths": widths.join(","),
          }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const count = normalizeColumnsCount(HTMLAttributes.count)
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "columns",
        "data-columns-count": String(count),
        "data-count": String(count),
        class: "doc-editor-columns",
      }),
      0,
    ]
  },

  addCommands() {
    return {
      insertColumns:
        (options = {}) =>
        ({ state, commands }) => {
          if (isInsideColumnSelection(state)) {
            return false
          }
          const count = normalizeColumnsCount(options.count ?? 2)
          const json = buildColumnsNodeJson(count)
          const widths = normalizeColumnsWidths(options.widths, count)
          return commands.insertContent({
            ...json,
            attrs: {
              ...(json.attrs ?? {}),
              count,
              widths,
            },
          })
        },
      setColumnsCount:
        (options) =>
        ({ tr, state, dispatch }) => {
          const pos = Number(options.pos)
          if (!Number.isFinite(pos)) {
            return false
          }
          const current = state.doc.nodeAt(pos)
          if (!current || current.type.name !== "columns") {
            return false
          }
          const nextJson = resizeColumnsJson(
            current.toJSON() as JSONContent,
            options.count,
            options.widths
          )
          const nextNode = state.schema.nodeFromJSON(nextJson)
          if (!dispatch) {
            return true
          }
          tr.replaceWith(pos, pos + current.nodeSize, nextNode)
          dispatch(tr)
          return true
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsNodeView)
  },
})
