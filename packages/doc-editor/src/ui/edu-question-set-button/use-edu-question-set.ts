"use client"

import { useCallback, useMemo } from "react"
import type { Editor } from "@tiptap/react"
import type { EduQuestionType } from "../../nodes/edu-question-set-node"
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { ListTodoIcon } from "../../icons/list-todo-icon"
import { isNodeInSchema } from "../../lib/tiptap-utils"

export const EDU_QUESTION_SET_SHORTCUT_KEY = "mod+shift+q"

export interface UseEduQuestionSetConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
}

export function canInsertEduQuestionSet(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("edu_question_set", editor)) return false
  return true
}

export function insertEduQuestionSet(
  editor: Editor | null,
  template: EduQuestionType = "choice",
): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertEduQuestionSet(editor)) return false

  try {
    editor.commands.insertEduQuestionSet({ template })
    return true
  } catch {
    return false
  }
}

export function shouldShowEduQuestionSetButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("edu_question_set", editor)) return false

  if (hideWhenUnavailable) {
    return canInsertEduQuestionSet(editor)
  }

  return true
}

export function useEduQuestionSet(config?: UseEduQuestionSetConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const canInsert = canInsertEduQuestionSet(editor)
  const isActive = editor?.isActive("edu_question_set") || false
  const isVisible = useMemo(
    () => shouldShowEduQuestionSetButton({ editor, hideWhenUnavailable }),
    [editor, hideWhenUnavailable],
  )

  const handleInsert = useCallback((template: EduQuestionType) => {
    if (!editor) return false

    const success = insertEduQuestionSet(editor, template)
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, onInserted])

  return {
    isVisible,
    isActive,
    canInsert,
    handleInsert,
    label: "Edu Question Set",
    shortcutKeys: EDU_QUESTION_SET_SHORTCUT_KEY,
    Icon: ListTodoIcon,
  }
}
