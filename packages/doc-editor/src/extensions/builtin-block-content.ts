import type { JSONContent } from "@tiptap/react"

import type { BuiltinBlockType } from "./block-add-handle"

function paragraphNode(): JSONContent {
  return { type: "paragraph" }
}

function headingNode(level: 1 | 2 | 3): JSONContent {
  return {
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

export function buildStandaloneBuiltinBlockContent(
  type: BuiltinBlockType,
): JSONContent | JSONContent[] {
  switch (type) {
    case "paragraph":
      return paragraphNode()
    case "heading-1":
      return headingNode(1)
    case "heading-2":
      return headingNode(2)
    case "heading-3":
      return headingNode(3)
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
    case "image":
      return { type: "imageUpload" }
    case "file":
      return { type: "file_block" }
    case "table":
      return tableNode(3, 3)
    default:
      return paragraphNode()
  }
}
