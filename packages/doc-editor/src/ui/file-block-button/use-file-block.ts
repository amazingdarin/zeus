import { useCallback, useEffect, useState } from "react"
import { type Editor } from "@tiptap/react"

import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { FileIcon } from "../../icons/file-icon"

export interface UseFileBlockConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
}

const hasFileBlockExtension = (editor: Editor | null) => {
  if (!editor) {
    return false
  }
  return editor.extensionManager.extensions.some((ext) => ext.name === "file_block")
}

export function canInsertFileBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!hasFileBlockExtension(editor)) return false

  return editor.can().insertContent({ type: "file_block" })
}

export function insertFileBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertFileBlock(editor)) return false

  try {
    return editor
      .chain()
      .focus()
      .insertContent({ type: "file_block" })
      .run()
  } catch {
    return false
  }
}

export function shouldShowFileBlockButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props
  if (!editor || !editor.isEditable) return false
  if (!hasFileBlockExtension(editor)) return false

  if (hideWhenUnavailable) {
    return canInsertFileBlock(editor)
  }

  return true
}

export function useFileBlock(props: UseFileBlockConfig) {
  const { editor: providedEditor, hideWhenUnavailable = false, onInserted } = props
  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState(false)
  const [canInsert, setCanInsert] = useState(false)

  useEffect(() => {
    setIsVisible(shouldShowFileBlockButton({ editor, hideWhenUnavailable }))
    setCanInsert(canInsertFileBlock(editor))
  }, [editor, hideWhenUnavailable])

  const handleInsert = useCallback(() => {
    if (insertFileBlock(editor)) {
      onInserted?.()
    }
  }, [editor, onInserted])

  return {
    editor,
    isVisible,
    canInsert,
    handleInsert,
    label: "File",
    Icon: FileIcon,
  }
}
