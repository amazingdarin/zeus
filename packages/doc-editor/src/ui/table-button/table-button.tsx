"use client"

import { forwardRef, useCallback } from "react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Tiptap UI ---
import type { UseTableConfig } from "./use-table"
import { useTable } from "./use-table"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"

export interface TableButtonProps
  extends Omit<ButtonProps, "type">,
    UseTableConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for inserting a table in a Tiptap editor.
 *
 * For custom button implementations, use the `useTable` hook instead.
 */
export const TableButton = forwardRef<HTMLButtonElement, TableButtonProps>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onInserted,
      defaultRows,
      defaultCols,
      withHeaderRow,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, canInsert, inTable, handleInsert, label, Icon } =
      useTable({
        editor,
        hideWhenUnavailable,
        onInserted,
        defaultRows,
        defaultCols,
        withHeaderRow,
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
        data-active-state={inTable ? "on" : "off"}
        role="button"
        disabled={!canInsert}
        data-disabled={!canInsert}
        tabIndex={-1}
        aria-label={label}
        tooltip="Insert Table"
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

TableButton.displayName = "TableButton"
