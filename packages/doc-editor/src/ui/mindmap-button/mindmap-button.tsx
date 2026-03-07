import { forwardRef, useCallback } from "react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"

export interface MindmapButtonProps extends Omit<ButtonProps, "type"> {
  /**
   * The editor instance. Uses context if not provided.
   */
  editor?: ReturnType<typeof useTiptapEditor>["editor"]
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
  /**
   * Hide the button when mindmap insertion is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback when a mindmap is inserted.
   */
  onInserted?: () => void
}

/**
 * Mindmap icon component
 */
function MindmapIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="4" cy="6" r="2" />
      <circle cx="20" cy="6" r="2" />
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <line x1="9.5" y1="10" x2="5.5" y2="7.5" />
      <line x1="14.5" y1="10" x2="18.5" y2="7.5" />
      <line x1="9.5" y1="14" x2="5.5" y2="16.5" />
      <line x1="14.5" y1="14" x2="18.5" y2="16.5" />
    </svg>
  )
}

/**
 * Button component for inserting mind maps in a Tiptap editor.
 */
export const MindmapButton = forwardRef<HTMLButtonElement, MindmapButtonProps>(
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

    // Check if mindmap can be inserted
    const canInsert =
      editor?.can().insertContent({ type: "mindmap" }) ?? false
    const isVisible = !hideWhenUnavailable || canInsert

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (!editor) return
        editor.commands.insertMindmap()
        onInserted?.()
      },
      [editor, onClick, onInserted]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        data-active-state="off"
        role="button"
        tabIndex={-1}
        disabled={!canInsert}
        data-disabled={!canInsert}
        aria-label="Insert Mind Map"
        aria-pressed={false}
        tooltip="插入脑图"
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <MindmapIcon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
          </>
        )}
      </Button>
    )
  }
)

MindmapButton.displayName = "MindmapButton"
