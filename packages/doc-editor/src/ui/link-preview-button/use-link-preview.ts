import { useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { isExtensionAvailable, isNodeInSchema } from "../../lib/tiptap-utils"
import { LinkIcon } from "../../icons/link-icon"

export interface UseLinkPreviewConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
}

export function useLinkPreview(config?: UseLinkPreviewConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState(true)

  const isLinkPreviewAvailable = editor
    ? (isNodeInSchema("link_preview", editor) ||
       isExtensionAvailable(editor, "link_preview"))
    : false

  const canInsert = isLinkPreviewAvailable && editor?.isEditable

  useEffect(() => {
    if (!editor) return
    const handleSelectionUpdate = () => {
      setIsVisible(!hideWhenUnavailable || isLinkPreviewAvailable)
    }
    handleSelectionUpdate()
    editor.on("selectionUpdate", handleSelectionUpdate)
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable, isLinkPreviewAvailable])

  return {
    isVisible,
    canInsert,
    label: "Link Preview",
    Icon: LinkIcon,
  }
}
