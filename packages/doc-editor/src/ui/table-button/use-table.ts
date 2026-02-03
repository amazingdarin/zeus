"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Lib ---
import { isNodeInSchema } from "../../lib/tiptap-utils"

// --- Icons ---
import { TableIcon } from "../../icons/table-icon"

/**
 * Configuration for the table functionality
 */
export interface UseTableConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether the button should hide when table is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful table insert.
   */
  onInserted?: () => void
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

/**
 * Checks if a table can be inserted in the current editor state
 */
export function canInsertTable(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("table", editor)) return false

  return editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })
}

/**
 * Checks if currently inside a table
 */
export function isInTable(editor: Editor | null): boolean {
  if (!editor) return false
  return editor.isActive("table")
}

/**
 * Inserts a table into the editor
 */
export function insertTable(
  editor: Editor | null,
  options: { rows?: number; cols?: number; withHeaderRow?: boolean } = {}
): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertTable(editor)) return false

  const { rows = 3, cols = 3, withHeaderRow = true } = options

  try {
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow })
      .run()
    return true
  } catch {
    return false
  }
}

/**
 * Deletes the current table
 */
export function deleteTable(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isInTable(editor)) return false

  try {
    editor.chain().focus().deleteTable().run()
    return true
  } catch {
    return false
  }
}

/**
 * Adds a row before the current row
 */
export function addRowBefore(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().addRowBefore().run()
    return true
  } catch {
    return false
  }
}

/**
 * Adds a row after the current row
 */
export function addRowAfter(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().addRowAfter().run()
    return true
  } catch {
    return false
  }
}

/**
 * Deletes the current row
 */
export function deleteRow(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().deleteRow().run()
    return true
  } catch {
    return false
  }
}

/**
 * Adds a column before the current column
 */
export function addColumnBefore(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().addColumnBefore().run()
    return true
  } catch {
    return false
  }
}

/**
 * Adds a column after the current column
 */
export function addColumnAfter(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().addColumnAfter().run()
    return true
  } catch {
    return false
  }
}

/**
 * Deletes the current column
 */
export function deleteColumn(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().deleteColumn().run()
    return true
  } catch {
    return false
  }
}

/**
 * Merges selected cells
 */
export function mergeCells(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().mergeCells().run()
    return true
  } catch {
    return false
  }
}

/**
 * Splits a merged cell
 */
export function splitCell(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().splitCell().run()
    return true
  } catch {
    return false
  }
}

/**
 * Toggles header row
 */
export function toggleHeaderRow(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().toggleHeaderRow().run()
    return true
  } catch {
    return false
  }
}

/**
 * Toggles header column
 */
export function toggleHeaderColumn(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable || !isInTable(editor)) return false
  try {
    editor.chain().focus().toggleHeaderColumn().run()
    return true
  } catch {
    return false
  }
}

/**
 * Determines if the table button should be shown
 */
export function shouldShowTableButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("table", editor)) return false

  if (hideWhenUnavailable) {
    return canInsertTable(editor)
  }

  return true
}

/**
 * Custom hook that provides table functionality for Tiptap editor
 */
export function useTable(config?: UseTableConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
    defaultRows = 3,
    defaultCols = 3,
    withHeaderRow = true,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canInsertState = canInsertTable(editor)
  const inTable = isInTable(editor)

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowTableButton({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const handleInsert = useCallback(() => {
    if (!editor) return false

    const success = insertTable(editor, {
      rows: defaultRows,
      cols: defaultCols,
      withHeaderRow,
    })
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, defaultRows, defaultCols, withHeaderRow, onInserted])

  const handleDelete = useCallback(() => {
    return deleteTable(editor)
  }, [editor])

  const handleAddRowBefore = useCallback(() => {
    return addRowBefore(editor)
  }, [editor])

  const handleAddRowAfter = useCallback(() => {
    return addRowAfter(editor)
  }, [editor])

  const handleDeleteRow = useCallback(() => {
    return deleteRow(editor)
  }, [editor])

  const handleAddColumnBefore = useCallback(() => {
    return addColumnBefore(editor)
  }, [editor])

  const handleAddColumnAfter = useCallback(() => {
    return addColumnAfter(editor)
  }, [editor])

  const handleDeleteColumn = useCallback(() => {
    return deleteColumn(editor)
  }, [editor])

  const handleMergeCells = useCallback(() => {
    return mergeCells(editor)
  }, [editor])

  const handleSplitCell = useCallback(() => {
    return splitCell(editor)
  }, [editor])

  const handleToggleHeaderRow = useCallback(() => {
    return toggleHeaderRow(editor)
  }, [editor])

  const handleToggleHeaderColumn = useCallback(() => {
    return toggleHeaderColumn(editor)
  }, [editor])

  return {
    isVisible,
    inTable,
    canInsert: canInsertState,
    handleInsert,
    handleDelete,
    handleAddRowBefore,
    handleAddRowAfter,
    handleDeleteRow,
    handleAddColumnBefore,
    handleAddColumnAfter,
    handleDeleteColumn,
    handleMergeCells,
    handleSplitCell,
    handleToggleHeaderRow,
    handleToggleHeaderColumn,
    label: "Table",
    Icon: TableIcon,
  }
}
