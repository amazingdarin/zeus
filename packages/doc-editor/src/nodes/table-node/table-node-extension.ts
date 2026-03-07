import { Table } from "@tiptap/extension-table"
import { TableRow } from "@tiptap/extension-table-row"
import { TableHeader } from "@tiptap/extension-table-header"
import { TableCell } from "@tiptap/extension-table-cell"
import type { Extensions } from "@tiptap/core"

export interface TableNodeOptions {
  /**
   * Whether to allow table resizing
   * @default true
   */
  resizable?: boolean
  /**
   * Default number of rows when inserting a table
   * @default 3
   */
  defaultRows?: number
  /**
   * Default number of columns when inserting a table
   * @default 3
   */
  defaultCols?: number
  /**
   * Whether to include a header row by default
   * @default true
   */
  withHeaderRow?: boolean
}

const defaultOptions: TableNodeOptions = {
  resizable: true,
  defaultRows: 3,
  defaultCols: 3,
  withHeaderRow: true,
}

/**
 * Creates the table extensions bundle with custom configuration
 */
export function createTableExtensions(options: TableNodeOptions = {}): Extensions {
  const opts = { ...defaultOptions, ...options }

  return [
    Table.configure({
      resizable: opts.resizable,
      HTMLAttributes: {
        class: "zeus-table",
      },
    }),
    TableRow.configure({
      HTMLAttributes: {
        class: "zeus-table-row",
      },
    }),
    TableHeader.configure({
      HTMLAttributes: {
        class: "zeus-table-header",
      },
    }),
    TableCell.configure({
      HTMLAttributes: {
        class: "zeus-table-cell",
      },
    }),
  ]
}

/**
 * Pre-configured table extensions with default options
 */
export const TableExtensions = createTableExtensions()

// Re-export individual extensions for advanced usage
export { Table, TableRow, TableHeader, TableCell }
