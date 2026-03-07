import { forwardRef, useCallback, useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"

// --- UI Primitives ---
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"

// --- Icons ---
import { ChevronDownIcon } from "../../icons/chevron-down-icon"

import type { ChartType } from "../../nodes/chart-node/chart-node-extension"

// Chart type options
const CHART_OPTIONS: { type: ChartType; label: string; icon: string }[] = [
  { type: "bar", label: "柱状图", icon: "📊" },
  { type: "line", label: "折线图", icon: "📈" },
  { type: "pie", label: "饼图", icon: "🥧" },
  { type: "scatter", label: "散点图", icon: "⚬" },
  { type: "radar", label: "雷达图", icon: "🕸️" },
  { type: "funnel", label: "漏斗图", icon: "🔻" },
]

export interface ChartButtonProps extends Omit<ButtonProps, "type"> {
  /**
   * The editor instance. Uses context if not provided.
   */
  editor?: ReturnType<typeof useTiptapEditor>["editor"]
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
  /**
   * Hide the button when chart insertion is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback when a chart is inserted.
   */
  onInserted?: (chartType: ChartType) => void
}

/**
 * Chart icon component
 */
function ChartIcon({ className }: { className?: string }) {
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
      <rect x="3" y="10" width="4" height="10" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="17" y="2" width="4" height="18" rx="1" />
    </svg>
  )
}

/**
 * Button component for inserting charts in a Tiptap editor.
 * Shows a dropdown menu to select chart type.
 */
export const ChartButton = forwardRef<HTMLButtonElement, ChartButtonProps>(
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

    const [showDropdown, setShowDropdown] = useState(false)
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    // Check if chart can be inserted
    const canInsert = editor?.can().insertContent({ type: "chart" }) ?? false
    const isVisible = !hideWhenUnavailable || canInsert

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

    const handleInsertChart = useCallback(
      (chartType: ChartType) => {
        if (!editor) return
        editor.commands.insertChart({ chartType, mode: "simple" })
        onInserted?.(chartType)
        setShowDropdown(false)
      },
      [editor, onInserted]
    )

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
          aria-label="Insert Chart"
          aria-pressed={false}
          aria-haspopup="menu"
          aria-expanded={showDropdown}
          tooltip="插入图表"
          onClick={handleClick}
          {...buttonProps}
          ref={mergeRefs}
        >
          {children ?? (
            <>
              <ChartIcon className="tiptap-button-icon" />
              {text && <span className="tiptap-button-text">{text}</span>}
              <ChevronDownIcon className="tiptap-button-dropdown-small" />
            </>
          )}
        </Button>
        {showDropdown &&
          createPortal(
            <div
              className="chart-dropdown"
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                zIndex: 10000,
              }}
            >
              {CHART_OPTIONS.map(({ type, label, icon }) => (
                <button
                  key={type}
                  type="button"
                  className="chart-dropdown-option"
                  onClick={() => handleInsertChart(type)}
                >
                  <span className="chart-dropdown-icon">{icon}</span>
                  <span className="chart-dropdown-label">{label}</span>
                </button>
              ))}
            </div>,
            document.body
          )}
      </>
    )
  }
)

ChartButton.displayName = "ChartButton"
