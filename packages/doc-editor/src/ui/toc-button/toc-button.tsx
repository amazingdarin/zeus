import { forwardRef, useCallback } from "react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Tiptap UI ---
import type { UseTocConfig } from "./use-toc"
import { useToc } from "./use-toc"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"

export interface TocButtonProps
  extends Omit<ButtonProps, "type">,
    UseTocConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for inserting a Table of Contents in a Tiptap editor.
 *
 * For custom button implementations, use the `useToc` hook instead.
 */
export const TocButton = forwardRef<HTMLButtonElement, TocButtonProps>(
  (
    {
      editor: providedEditor,
      text,
      onInserted,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, canInsert, handleInsert, label, Icon } = useToc({
      editor,
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
        disabled={!canInsert}
        data-disabled={!canInsert}
        tabIndex={-1}
        aria-label={label}
        tooltip="目录"
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

TocButton.displayName = "TocButton"
