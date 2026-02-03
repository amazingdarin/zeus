import { forwardRef, useCallback, useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Lib ---
import { parseShortcutKeys } from "../../lib/tiptap-utils"

// --- Tiptap UI ---
import type { UseMusicConfig } from "./use-music"
import { MUSIC_INLINE_SHORTCUT_KEY, useMusic } from "./use-music"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"
import { Badge } from "../../primitives/badge"

// --- Icons ---
import { ChevronDownIcon } from "../../icons/chevron-down-icon"

export interface MusicButtonProps
  extends Omit<ButtonProps, "type">,
    UseMusicConfig {
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

export function MusicShortcutBadge({
  shortcutKeys = MUSIC_INLINE_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>
}

/**
 * Button component for inserting music scores in a Tiptap editor.
 * Supports both inline and block music.
 *
 * For custom button implementations, use the `useMusic` hook instead.
 */
export const MusicButton = forwardRef<HTMLButtonElement, MusicButtonProps>(
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
    } = useMusic({
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
          tooltip="Music Score"
          onClick={handleClick}
          {...buttonProps}
          ref={mergeRefs}
        >
          {children ?? (
            <>
              <Icon className="tiptap-button-icon" />
              {text && <span className="tiptap-button-text">{text}</span>}
              <ChevronDownIcon className="tiptap-button-dropdown-small" />
              {showShortcut && (
                <MusicShortcutBadge shortcutKeys={inlineShortcutKeys} />
              )}
            </>
          )}
        </Button>
        {showDropdown &&
          createPortal(
            <div
              className="music-dropdown"
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: dropdownPosition.top,
                left: dropdownPosition.left,
              }}
            >
              <button
                type="button"
                className="music-dropdown-option"
                onClick={handleInlineClick}
              >
                <span className="music-dropdown-label">Inline Music</span>
                <span className="music-dropdown-example">~abc:C D E F~</span>
              </button>
              <button
                type="button"
                className="music-dropdown-option"
                onClick={handleBlockClick}
              >
                <span className="music-dropdown-label">Block Music</span>
                <span className="music-dropdown-example">```abc...```</span>
              </button>
            </div>,
            document.body
          )}
      </>
    )
  }
)

MusicButton.displayName = "MusicButton"
