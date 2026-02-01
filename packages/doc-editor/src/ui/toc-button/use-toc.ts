"use client"

import { useCallback } from "react"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Lib ---
import { isNodeInSchema } from "../../lib/tiptap-utils"

// --- Icons ---
import { TocIcon } from "../../icons/toc-icon"

/**
 * Configuration for the TOC functionality
 */
export interface UseTocConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Callback function called after a successful TOC insertion.
   */
  onInserted?: () => void
}

/**
 * Checks if TOC can be inserted in the current editor state
 */
export function canInsertToc(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("toc", editor)) return false
  return editor.can().insertContent({ type: "toc" })
}

/**
 * Inserts a TOC block in the editor
 */
export function insertToc(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertToc(editor)) return false

  try {
    editor.chain().focus().insertContent({ type: "toc" }).run()
    return true
  } catch {
    return false
  }
}

/**
 * Custom hook that provides TOC functionality for Tiptap editor
 */
export function useToc(config?: UseTocConfig) {
  const { editor: providedEditor, onInserted } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const canInsertState = canInsertToc(editor)

  const handleInsert = useCallback(() => {
    if (!editor) return false

    const success = insertToc(editor)
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, onInserted])

  return {
    isVisible: Boolean(editor && isNodeInSchema("toc", editor)),
    canInsert: canInsertState,
    handleInsert,
    label: "目录",
    Icon: TocIcon,
  }
}
