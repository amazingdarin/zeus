import type { JSONContent } from "@tiptap/react"

import type { BuiltinBlockType } from "./block-add-handle"
import { normalizeColumnsCount, normalizeColumnsWidths } from "../nodes/columns-node/columns-transform"

function paragraphNode(): JSONContent {
  return { type: "paragraph" }
}

function headingNode(level: 1 | 2 | 3, collapsible = false): JSONContent {
  return collapsible
    ? {
        type: "heading",
        attrs: { level, collapsible: true },
      }
    : {
        type: "heading",
        attrs: { level },
      }
}

function listItemNode(): JSONContent {
  return {
    type: "listItem",
    content: [paragraphNode()],
  }
}

function taskItemNode(): JSONContent {
  return {
    type: "taskItem",
    attrs: { checked: false },
    content: [paragraphNode()],
  }
}

function tableCellNode(cellType: "tableHeader" | "tableCell"): JSONContent {
  return {
    type: cellType,
    content: [paragraphNode()],
  }
}

function tableRowNode(columnCount: number, withHeader: boolean): JSONContent {
  const cellType = withHeader ? "tableHeader" : "tableCell"
  return {
    type: "tableRow",
    content: Array.from({ length: columnCount }, () => tableCellNode(cellType)),
  }
}

function tableNode(rows: number, columns: number): JSONContent {
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, index) =>
      tableRowNode(columns, index === 0),
    ),
  }
}

function columnsNode(countInput: unknown, widthsInput?: unknown): JSONContent {
  const count = normalizeColumnsCount(countInput)
  const widths = normalizeColumnsWidths(widthsInput, count)
  return {
    type: "columns",
    attrs: { count, widths },
    content: Array.from({ length: count }, () => ({
      type: "column",
      content: [paragraphNode()],
    })),
  }
}

export function buildStandaloneBuiltinBlockContent(
  type: BuiltinBlockType,
  options?: { columns?: { count?: number; widths?: unknown } },
): JSONContent | JSONContent[] {
  switch (type) {
    case "paragraph":
      return paragraphNode()
    case "heading-1":
      return headingNode(1)
    case "collapsible-heading-1":
      return headingNode(1, true)
    case "heading-2":
      return headingNode(2)
    case "collapsible-heading-2":
      return headingNode(2, true)
    case "heading-3":
      return headingNode(3)
    case "collapsible-heading-3":
      return headingNode(3, true)
    case "toggle-block":
      return [
        {
          type: "heading",
          attrs: { level: 3, collapsible: true },
          content: [{ type: "text", text: "可折叠块" }],
        },
        paragraphNode(),
      ]
    case "bullet-list":
      return {
        type: "bulletList",
        content: [listItemNode()],
      }
    case "ordered-list":
      return {
        type: "orderedList",
        content: [listItemNode()],
      }
    case "task-list":
      return {
        type: "taskList",
        content: [taskItemNode()],
      }
    case "blockquote":
      return {
        type: "blockquote",
        content: [paragraphNode()],
      }
    case "horizontal-rule":
      return { type: "horizontalRule" }
    case "code-block":
      return { type: "codeBlock" }
    case "math":
      return {
        type: "paragraph",
        content: [
          {
            type: "math",
            attrs: { latex: "", display: true },
          },
        ],
      }
    case "chart":
      return { type: "chart" }
    case "mindmap":
      return { type: "mindmap" }
    case "toc":
      return { type: "toc" }
    case "link-preview":
      return {
        type: "link_preview",
        attrs: {
          url: "",
          status: "idle",
        },
      }
    case "image":
      return { type: "imageUpload" }
    case "file":
      return { type: "file_block" }
    case "table":
      return tableNode(3, 3)
    case "columns":
      return columnsNode(options?.columns?.count ?? 2, options?.columns?.widths)
    case "columns-2":
      return columnsNode(2)
    case "columns-3":
      return columnsNode(3)
    case "columns-4":
      return columnsNode(4)
    case "columns-5":
      return columnsNode(5)
    default:
      return paragraphNode()
  }
}
