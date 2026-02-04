"use client"

import { forwardRef, useCallback } from "react"

import type { UseHorizontalRuleConfig } from "./use-horizontal-rule"
import { useHorizontalRule } from "./use-horizontal-rule"
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"

export interface HorizontalRuleButtonProps
  extends Omit<ButtonProps, "type">,
    UseHorizontalRuleConfig {
  text?: string
}

export const HorizontalRuleButton = forwardRef<
  HTMLButtonElement,
  HorizontalRuleButtonProps
>(
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
    const { isVisible, canInsert, handleInsert, label, Icon } = useHorizontalRule({
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
        disabled={!canInsert}
        data-disabled={!canInsert}
        tabIndex={-1}
        aria-label={label}
        tooltip="Horizontal Rule"
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

HorizontalRuleButton.displayName = "HorizontalRuleButton"
