import { useState, useEffect } from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { isExtensionAvailable, isNodeInSchema } from "../../lib/tiptap-utils"
import { OpenApiIcon } from "../../icons/openapi-icon"

export interface UseOpenApiDropdownMenuConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
}

export function useOpenApiDropdownMenu(config?: UseOpenApiDropdownMenuConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState(true)

  const isOpenApiNodeAvailable = editor
    ? (isNodeInSchema("openapi", editor) ||
       isExtensionAvailable(editor, "openapi"))
    : false

  const canInsert = isOpenApiNodeAvailable && editor?.isEditable

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(
        !hideWhenUnavailable || isOpenApiNodeAvailable
      )
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable, isOpenApiNodeAvailable])

  return {
    isVisible,
    canInsert,
    label: "OpenAPI",
    Icon: OpenApiIcon,
  }
}
