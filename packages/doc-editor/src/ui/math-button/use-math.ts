"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Icons ---
import { MathIcon } from "../../icons/math-icon"

// --- UI Utils ---
import { isNodeInSchema } from "../../lib/tiptap-utils"

export const MATH_INLINE_SHORTCUT_KEY = "mod+shift+m"
export const MATH_BLOCK_SHORTCUT_KEY = "mod+shift+M"

/**
 * Configuration for the math functionality
 */
export interface UseMathConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether the button should hide when math is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful insertion.
   */
  onInserted?: () => void
}

/**
 * Checks if math can be inserted in the current editor state
 */
export function canInsertMath(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("math", editor)) return false
  return true
}

/**
 * Inserts a math formula
 */
export function insertMath(
  editor: Editor | null,
  display: boolean = false
): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertMath(editor)) return false

  try {
    editor.commands.insertMath({ latex: "", display })
    return true
  } catch {
    return false
  }
}

/**
 * Determines if the math button should be shown
 */
export function shouldShowMathButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("math", editor)) return false

  if (hideWhenUnavailable) {
    return canInsertMath(editor)
  }

  return true
}

/**
 * Custom hook that provides math functionality for Tiptap editor
 */
export function useMath(config?: UseMathConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canInsert = canInsertMath(editor)
  const isActive = editor?.isActive("math") || false

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowMathButton({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const handleInsertInline = useCallback(() => {
    if (!editor) return false

    const success = insertMath(editor, false)
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, onInserted])

  const handleInsertBlock = useCallback(() => {
    if (!editor) return false

    const success = insertMath(editor, true)
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, onInserted])

  return {
    isVisible,
    isActive,
    canInsert,
    handleInsertInline,
    handleInsertBlock,
    label: "Math Formula",
    inlineShortcutKeys: MATH_INLINE_SHORTCUT_KEY,
    blockShortcutKeys: MATH_BLOCK_SHORTCUT_KEY,
    Icon: MathIcon,
  }
}
