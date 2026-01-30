import { forwardRef, useCallback, useState } from "react"

import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"
import type { UseLinkPreviewConfig } from "./use-link-preview"
import { useLinkPreview } from "./use-link-preview"

export interface LinkPreviewButtonProps
  extends Omit<ButtonProps, "type">,
    UseLinkPreviewConfig {
  text?: string
}

export const LinkPreviewButton = forwardRef<HTMLButtonElement, LinkPreviewButtonProps>(
  ({ editor: providedEditor, hideWhenUnavailable = false, text, ...buttonProps }, ref) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, canInsert, Icon } = useLinkPreview({
      editor,
      hideWhenUnavailable,
    })
    const [loading, setLoading] = useState(false)

    const handleInsert = useCallback(() => {
      if (!editor || !canInsert || loading) return
      setLoading(true)
      editor
        .chain()
        .focus()
        .insertContent({
          type: "link_preview",
          attrs: {
            url: "",
            status: "idle",
          },
        })
        .run()
      setLoading(false)
    }, [canInsert, editor, loading])

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        role="button"
        tabIndex={-1}
        disabled={!canInsert}
        data-disabled={!canInsert}
        aria-label="Insert link preview"
        tooltip="Link Preview"
        onClick={handleInsert}
        {...buttonProps}
        ref={ref}
      >
        <Icon className="tiptap-button-icon" />
        {text && <span className="tiptap-button-text">{text}</span>}
      </Button>
    )
  }
)

LinkPreviewButton.displayName = "LinkPreviewButton"

export default LinkPreviewButton
