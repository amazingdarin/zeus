import { useCallback, forwardRef } from "react"

import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"
import type { UseFileBlockConfig } from "./use-file-block"
import { useFileBlock } from "./use-file-block"

export interface FileBlockButtonProps
  extends Omit<ButtonProps, "type">,
    UseFileBlockConfig {
  text?: string
}

export const FileBlockButton = forwardRef<HTMLButtonElement, FileBlockButtonProps>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onInserted,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, canInsert, handleInsert, label, Icon } = useFileBlock({
      editor,
      hideWhenUnavailable,
      onInserted,
    })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleInsert()
      },
      [handleInsert, onClick]
    )

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
        aria-label={label}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
          </>
        )}
      </Button>
    )
  }
)

FileBlockButton.displayName = "FileBlockButton"
