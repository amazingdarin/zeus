import { forwardRef, useCallback, useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Lib ---
import { parseShortcutKeys } from "../../lib/tiptap-utils"

// --- Tiptap UI ---
import type { UseMathConfig } from "./use-math"
import { MATH_INLINE_SHORTCUT_KEY, useMath } from "./use-math"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"
import { Badge } from "../../primitives/badge"

// --- Icons ---
import { ChevronDownIcon } from "../../icons/chevron-down-icon"

export interface MathButtonProps
  extends Omit<ButtonProps, "type">,
    UseMathConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
  /**
   * Optional show shortcut keys in the button.
   * @default false
   */
  showShortcut?: boolean
}

export function MathShortcutBadge({
  shortcutKeys = MATH_INLINE_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>
}

/**
 * Button component for inserting math formulas in a Tiptap editor.
 * Supports both inline and block math.
 *
 * For custom button implementations, use the `useMath` hook instead.
 */
export const MathButton = forwardRef<HTMLButtonElement, MathButtonProps>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onInserted,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const {
      isVisible,
      canInsert,
      handleInsertInline,
      handleInsertBlock,
      label,
      inlineShortcutKeys,
      Icon,
    } = useMath({
      editor,
      hideWhenUnavailable,
      onInserted,
    })

    const [showDropdown, setShowDropdown] = useState(false)
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    // Update dropdown position when shown
    useEffect(() => {
      if (showDropdown && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left,
        })
      }
    }, [showDropdown])

    // Close dropdown when clicking outside
    useEffect(() => {
      if (!showDropdown) return

      const handleClickOutside = (event: MouseEvent) => {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current &&
          !buttonRef.current.contains(event.target as Node)
        ) {
          setShowDropdown(false)
        }
      }

      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [showDropdown])

    // Close dropdown on scroll
    useEffect(() => {
      if (!showDropdown) return

      const handleScroll = (event: Event) => {
        if (
          dropdownRef.current &&
          event.target instanceof Node &&
          dropdownRef.current.contains(event.target)
        ) {
          return
        }
        setShowDropdown(false)
      }

      window.addEventListener("scroll", handleScroll, true)
      return () => window.removeEventListener("scroll", handleScroll, true)
    }, [showDropdown])

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setShowDropdown((prev) => !prev)
      },
      [onClick]
    )

    const handleInlineClick = useCallback(() => {
      handleInsertInline()
      setShowDropdown(false)
    }, [handleInsertInline])

    const handleBlockClick = useCallback(() => {
      handleInsertBlock()
      setShowDropdown(false)
    }, [handleInsertBlock])

    // Merge refs
    const mergeRefs = (el: HTMLButtonElement | null) => {
      buttonRef.current = el
      if (typeof ref === "function") {
        ref(el)
      } else if (ref) {
        ref.current = el
      }
    }

    if (!isVisible) {
      return null
    }

    return (
      <>
        <Button
          type="button"
          data-style="ghost"
          data-active-state="off"
          role="button"
          tabIndex={-1}
          disabled={!canInsert}
          data-disabled={!canInsert}
          aria-label={label}
          aria-pressed={false}
          aria-haspopup="menu"
          aria-expanded={showDropdown}
          tooltip="Math Formula"
          onClick={handleClick}
          {...buttonProps}
          ref={mergeRefs}
        >
          {children ?? (
            <>
              <Icon className="tiptap-button-icon" />
              {text && <span className="tiptap-button-text">{text}</span>}
              <ChevronDownIcon className="tiptap-button-dropdown" />
              {showShortcut && (
                <MathShortcutBadge shortcutKeys={inlineShortcutKeys} />
              )}
            </>
          )}
        </Button>
        {showDropdown &&
          createPortal(
            <div
              className="math-dropdown"
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: dropdownPosition.top,
                left: dropdownPosition.left,
              }}
            >
              <button
                type="button"
                className="math-dropdown-option"
                onClick={handleInlineClick}
              >
                <span className="math-dropdown-label">Inline Formula</span>
                <span className="math-dropdown-example">$E = mc^2$</span>
              </button>
              <button
                type="button"
                className="math-dropdown-option"
                onClick={handleBlockClick}
              >
                <span className="math-dropdown-label">Block Formula</span>
                <span className="math-dropdown-example">$$\int_0^\infty ...$$</span>
              </button>
            </div>,
            document.body
          )}
      </>
    )
  }
)

MathButton.displayName = "MathButton"
