import { forwardRef, useCallback, useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- Lib ---
import { parseShortcutKeys } from "../../lib/tiptap-utils"

// --- Tiptap UI ---
import type { UseCodeBlockConfig } from "./use-code-block"
import { CODE_BLOCK_SHORTCUT_KEY, useCodeBlock } from "./use-code-block"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"
import { Badge } from "../../primitives/badge"

// --- Icons ---
import { ChevronDownIcon } from "../../icons/chevron-down-icon"

const LANGUAGE_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "openapi", label: "OpenAPI" },
  { value: "html", label: "HTML" },
  { value: "mermaid", label: "Mermaid" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "plaintext", label: "Plain Text" },
]

export interface CodeBlockButtonProps
  extends Omit<ButtonProps, "type">,
    UseCodeBlockConfig {
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

export function CodeBlockShortcutBadge({
  shortcutKeys = CODE_BLOCK_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>
}

/**
 * Button component for toggling code block in a Tiptap editor.
 *
 * For custom button implementations, use the `useCodeBlock` hook instead.
 */
export const CodeBlockButton = forwardRef<
  HTMLButtonElement,
  CodeBlockButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onToggled,
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
      canToggle,
      isActive,
      handleToggle,
      label,
      shortcutKeys,
      Icon,
    } = useCodeBlock({
      editor,
      hideWhenUnavailable,
      onToggled,
    })

    const [showDropdown, setShowDropdown] = useState(false)
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
    const [codeBlockHovered, setCodeBlockHovered] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const dropdownTriggerRef = useRef<HTMLButtonElement>(null)

    // Listen for code block hover events from code block nodes
    useEffect(() => {
      const handleCodeBlockHover = (event: Event) => {
        const customEvent = event as CustomEvent<{ hover: boolean }>
        if (customEvent.detail && typeof customEvent.detail.hover === "boolean") {
          setCodeBlockHovered(customEvent.detail.hover)
        }
      }

      document.addEventListener("codeblock-hover", handleCodeBlockHover)
      return () => {
        document.removeEventListener("codeblock-hover", handleCodeBlockHover)
      }
    }, [])

    // Get current language when in code block
    const currentLanguage = isActive
      ? (editor?.getAttributes("codeBlock")?.language as string) || ""
      : ""
    const currentLanguageLabel =
      LANGUAGE_OPTIONS.find((opt) => opt.value === currentLanguage)?.label ||
      (currentLanguage || "Auto")

    // Update dropdown position when shown
    useEffect(() => {
      if (showDropdown && dropdownTriggerRef.current) {
        const rect = dropdownTriggerRef.current.getBoundingClientRect()
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left - 80, // Offset to align dropdown better
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
          dropdownTriggerRef.current &&
          !dropdownTriggerRef.current.contains(event.target as Node)
        ) {
          setShowDropdown(false)
        }
      }

      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [showDropdown])

    // Close dropdown on scroll (but not when scrolling inside the dropdown)
    useEffect(() => {
      if (!showDropdown) return

      const handleScroll = (event: Event) => {
        // Don't close if scrolling inside the dropdown
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

    // Handle main button click (toggle code block off when active)
    const handleMainClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleToggle()
      },
      [handleToggle, onClick]
    )

    // Handle dropdown trigger click (show language dropdown)
    const handleDropdownClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        setShowDropdown((prev) => !prev)
      },
      []
    )

    const handleLanguageSelect = useCallback(
      (language: string) => {
        if (!editor) return

        const supportsPreview =
          language === "openapi" || language === "html" || language === "mermaid"
        const renderer = supportsPreview ? language : "auto"

        editor
          .chain()
          .focus()
          .updateAttributes("codeBlock", {
            language: language || null,
            renderer,
          })
          .run()

        setShowDropdown(false)
      },
      [editor]
    )

    if (!isVisible) {
      return null
    }

    // Merge refs
    const mergeRefs = (el: HTMLButtonElement | null) => {
      buttonRef.current = el
      if (typeof ref === "function") {
        ref(el)
      } else if (ref) {
        ref.current = el
      }
    }

    // When active, show split button with two click areas
    if (isActive) {
      return (
        <>
          <div
            className="code-block-split-button"
            data-codeblock-hovered={codeBlockHovered}
          >
            {/* Main area: click to exit code block */}
            <Button
              type="button"
              data-style="ghost"
              data-active-state="on"
              role="button"
              disabled={!canToggle}
              data-disabled={!canToggle}
              tabIndex={-1}
              aria-label="Exit Code Block"
              aria-pressed={true}
              tooltip="Exit Code Block"
              onClick={handleMainClick}
              {...buttonProps}
              ref={mergeRefs}
            >
              <Icon className="tiptap-button-icon" />
              <span className="tiptap-button-text code-block-lang-text">
                {currentLanguageLabel}
              </span>
            </Button>
            {/* Dropdown trigger: click to show language dropdown */}
            <button
              type="button"
              className="code-block-dropdown-trigger"
              onClick={handleDropdownClick}
              ref={dropdownTriggerRef}
              aria-label="Select Language"
              title="Select Language"
            >
              <ChevronDownIcon className="code-block-dropdown-icon" />
            </button>
          </div>
          {showDropdown &&
            createPortal(
              <div
                className="code-block-language-dropdown"
                ref={dropdownRef}
                style={{
                  position: "fixed",
                  top: dropdownPosition.top,
                  left: dropdownPosition.left,
                }}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value || "auto"}
                    type="button"
                    className="code-block-language-option"
                    data-selected={option.value === currentLanguage}
                    onClick={() => handleLanguageSelect(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>,
              document.body
            )}
        </>
      )
    }

    // When not active, show simple button
    return (
      <Button
        type="button"
        data-style="ghost"
        data-active-state="off"
        role="button"
        disabled={!canToggle}
        data-disabled={!canToggle}
        tabIndex={-1}
        aria-label={label}
        aria-pressed={false}
        tooltip="Code Block"
        onClick={handleMainClick}
        {...buttonProps}
        ref={mergeRefs}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && (
              <CodeBlockShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

CodeBlockButton.displayName = "CodeBlockButton"
