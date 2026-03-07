"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { HorizontalRuleIcon } from "../../icons/horizontal-rule-icon"
import { isNodeInSchema } from "../../lib/tiptap-utils"

export interface UseHorizontalRuleConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
}

export function canInsertHorizontalRule(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("horizontalRule", editor)) return false

  return editor.can().setHorizontalRule()
}

export function insertHorizontalRule(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertHorizontalRule(editor)) return false

  try {
    return editor.chain().focus().setHorizontalRule().run()
  } catch {
    return false
  }
}

export function shouldShowHorizontalRuleButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("horizontalRule", editor)) return false

  if (hideWhenUnavailable) {
    return canInsertHorizontalRule(editor)
  }

  return true
}

export function useHorizontalRule(config?: UseHorizontalRuleConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState(false)
  const [canInsert, setCanInsert] = useState(false)

  useEffect(() => {
    if (!editor) return

    const updateState = () => {
      setIsVisible(
        shouldShowHorizontalRuleButton({
          editor,
          hideWhenUnavailable,
        })
      )
      setCanInsert(canInsertHorizontalRule(editor))
    }

    updateState()
    editor.on("selectionUpdate", updateState)
    editor.on("transaction", updateState)

    return () => {
      editor.off("selectionUpdate", updateState)
      editor.off("transaction", updateState)
    }
  }, [editor, hideWhenUnavailable])

  const handleInsert = useCallback(() => {
    if (insertHorizontalRule(editor)) {
      onInserted?.()
    }
  }, [editor, onInserted])

  return {
    isVisible,
    canInsert,
    handleInsert,
    label: "Horizontal Rule",
    Icon: HorizontalRuleIcon,
  }
}
